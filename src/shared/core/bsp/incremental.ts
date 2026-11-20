/**
 * Incremental BSP build (phase 3.5, stable BSP): rebuilds only the subtrees an edit touched and
 * copies the rest from the previous build. The result is identical to {@link buildBsp}.
 *
 * Why it is exact: a node's subtree depends only on its fragments (windings and interned planes)
 * and its region; nothing else is read (refinement reads every wall, so it is off there, see
 * {@link incrementalBspApplies}). Splitter candidates are scanned in canonical plane order
 * (`planeRanks`), so fragment order and plane numbering do not matter. The region is the root box
 * clipped by the ancestors' planes in order, so it is fixed by (bounds, ancestor path). Hence the
 * node key: bounds + path of (plane, side) + the set of fragment ids, where a fragment id names an
 * exact wall (winding + interned plane numbers) or a side of a split of another id by a plane.
 *
 * In preorder (front first) a subtree occupies a contiguous range of nodes and of leaves, so a hit
 * copies that range from the previous tree, shifting child refs and mapping plane indices (and
 * region tags) through the planes' exact numbers.
 */

import type { Cell, Dim, Facet, Geometry, Plane } from "../geometry";
import type { Wall } from "../wall";
import { type BspBuildOptions, type BspBuildResult, type Fragment, buildBsp, chooseSplitter, partitionWith, prepareBuild, treeResult } from "./build";
import { refinementEnabled } from "./refine";
import { type BspLeaf, type BspNode, type BspTree, type ChildRef, isLeafRef, leafRef, refToLeaf } from "./types";

/** A wall fragment with a session-stable id (see module docs). */
interface IdFragment<D extends Dim> extends Fragment<D> {
  readonly id: number;
}

/** Subtree of node `i` in a cached tree: nodes [i, nodeEnd), leaves [leafStart, leafEnd). */
interface NodeRange {
  readonly key: string;
  readonly nodeEnd: number;
  readonly leafStart: number;
  readonly leafEnd: number;
  /** Wall fragments split inside the subtree (its share of `BspStats.splitCount`). */
  readonly splits: number;
  /** Split ids this node's partition named (key, id), re-registered when the node is copied. */
  readonly pieceIds: readonly (readonly [string, number])[];
}

/** What one incremental build leaves for the next; opaque to callers. */
export interface BspCache<D extends Dim> {
  readonly tree: BspTree<D>;
  /** Exact key of each of `tree.planes`. */
  readonly planeKeys: readonly string[];
  /** `ranges[i]`: subtree of node i. */
  readonly ranges: readonly NodeRange[];
  /** Node key → node index. */
  readonly byKey: ReadonlyMap<string, number>;
  /**
   * Exact keys (walls, splits, planes) → session ids, only those the last build used (so a long
   * session does not grow it); ids stay stable across builds while their key is in use.
   */
  readonly ids: ReadonlyMap<string, number>;
  /** Next fresh id (never reused: a dropped key's id may still sit in an old node key). */
  readonly nextId: number;
  readonly optionsKey: string;
}

export interface IncrementalBspResult<D extends Dim> {
  readonly result: BspBuildResult<D>;
  /** Cache for the next build (null when the incremental path does not apply). */
  readonly cache: BspCache<D> | null;
  /** Nodes copied from the previous build. */
  readonly reusedNodes: number;
}

/** The incremental path needs a build that reads only a node's fragments and region: no refinement. */
export function incrementalBspApplies(opts: BspBuildOptions): boolean {
  return !refinementEnabled(opts);
}

/**
 * Builds the tree of `walls` like `buildBsp(g, walls, opts)`, reusing subtrees of `cache` (from the
 * previous call; null for the first). Falls back to a plain build when refinement is enabled.
 */
export function buildBspIncremental<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], opts: BspBuildOptions, cache: BspCache<D> | null): IncrementalBspResult<D> {
  if (!incrementalBspApplies(opts)) return { result: buildBsp(g, walls, opts), cache: null, reusedNodes: 0 };
  const ctx = prepareBuild(g, walls, opts);
  const optionsKey = JSON.stringify(opts);
  const prevIds = cache?.ids ?? new Map<string, number>();
  const ids = new Map<string, number>(); // keys used by this build
  let nextId = cache?.nextId ?? 0;
  const idOf = (key: string): number => {
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = prevIds.get(key) ?? nextId++));
    return id;
  };
  const packed: number[] = [];
  const planeKey = (p: Plane<D>): string => exactKey([...g.coords(p.n), p.d]);
  const planeKeys = ctx.planes.map(planeKey);
  const planeIds = planeKeys.map((k) => idOf(`p${k}`));
  const facetKey = (f: Facet<D>): string => {
    packed.length = 0;
    g.packFacet(f, packed);
    return exactKey(packed);
  };
  // A plane's bias steers every subtree that has it as a candidate, so it is part of its fragments' ids.
  const biasKey = (p: number): string => (ctx.planeBias && ctx.planeBias[p] !== 0 ? `b${exactKey([ctx.planeBias[p]])};` : "");
  const frags: IdFragment<D>[] = ctx.fragments.map((f) => ({ ...f, id: idOf(`w${planeKeys[f.plane]};${biasKey(f.plane)}${facetKey(f.winding)}`) }));
  let splitPlane = -1; // the plane `piece` splits by (set before each partition)
  let pieceIds: [string, number][] = []; // split ids named by the current partition
  const piece = (parent: IdFragment<D>, winding: Facet<D>, front: boolean): IdFragment<D> => {
    const key = `s${parent.id}/${planeIds[splitPlane]}${front ? "f" : "b"}`, id = idOf(key);
    pieceIds.push([key, id]);
    return { winding, plane: parent.plane, id };
  };

  const old = cache && cache.optionsKey === optionsKey ? cache : null;
  // Old plane index → new one, by exact numbers (a reused subtree only uses planes of its fragments, which exist now).
  const newIndex = new Map(planeKeys.map((k, i) => [k, i]));
  const planeMap = old ? old.planeKeys.map((k) => newIndex.get(k) ?? -1) : [];
  const identity = planeMap.every((m, i) => m === i);
  const retag = (c: Cell<D> | null): Cell<D> | null => (c && !identity ? g.retagCell(c, (t) => (t >= 0 ? planeMap[t] : t)) : c);

  const nodes: BspNode<D>[] = [];
  const leaves: BspLeaf<D>[] = [];
  const ranges: NodeRange[] = [];
  const byKey = new Map<string, number>();
  let splitCount = 0;
  let reusedNodes = 0;

  const addLeaf = (contents: BspLeaf<D>["contents"], region: Cell<D> | null, depth: number): ChildRef => {
    leaves.push({ contents, region, depth });
    return leafRef(leaves.length - 1);
  };

  /** Copies old node `at`'s subtree (and its ranges, for the next build) to the end of the new arrays. */
  const copy = (at: number): ChildRef => {
    const src = old!.tree, r = old!.ranges[at];
    const nodeShift = nodes.length - at, leafShift = leaves.length - r.leafStart;
    const ref = (c: ChildRef): ChildRef => (isLeafRef(c) ? leafRef(refToLeaf(c) + leafShift) : c + nodeShift);
    for (let i = at; i < r.nodeEnd; i++) {
      const n = src.nodes[i], q = old!.ranges[i];
      nodes.push({ plane: planeMap[n.plane], front: ref(n.front), back: ref(n.back), region: retag(n.region) });
      ranges.push({ ...q, nodeEnd: q.nodeEnd + nodeShift, leafStart: q.leafStart + leafShift, leafEnd: q.leafEnd + leafShift });
      for (const [key, id] of q.pieceIds) ids.set(key, id); // keep the subtree's split ids alive
      byKey.set(q.key, i + nodeShift);
    }
    for (let i = r.leafStart; i < r.leafEnd; i++) {
      const l = src.leaves[i];
      leaves.push(identity ? l : { ...l, region: retag(l.region) });
    }
    splitCount += r.splits;
    reusedNodes += r.nodeEnd - at;
    return at + nodeShift;
  };

  /** `buildSubtree`'s recursion (refinement off), keyed by `path` and the fragment ids. */
  const build = (fs: readonly IdFragment<D>[], region: Cell<D> | null, depth: number, path: string): ChildRef => {
    const key = `${path}#${Int32Array.from(fs, (f) => f.id).sort().join(",")}`;
    const hit = old?.byKey.get(key);
    if (hit !== undefined) return copy(hit);

    const planeIndex = chooseSplitter(g, fs, ctx);
    const plane = ctx.planes[planeIndex];
    splitPlane = planeIndex;
    pieceIds = [];
    const part = partitionWith(g, fs, planeIndex, ctx.planes, piece);
    const myPieceIds = pieceIds;
    const splitsBefore = splitCount;
    splitCount += part.splits;
    const nodeIndex = nodes.length, leafStart = leaves.length;
    nodes.push(null as unknown as BspNode<D>);
    ranges.push(null as unknown as NodeRange);
    const frontRegion = region && g.clipCell(region, plane, planeIndex);
    const backRegion = region && g.clipCell(region, g.flipPlane(plane), planeIndex);
    const step = `${path}/${planeIds[planeIndex]}`;
    const front = part.front.length > 0 ? build(part.front, frontRegion, depth + 1, `${step}f`) : addLeaf("empty", frontRegion, depth + 1);
    const back = part.back.length > 0 ? build(part.back, backRegion, depth + 1, `${step}b`) : addLeaf("solid", backRegion, depth + 1);
    nodes[nodeIndex] = { plane: planeIndex, front, back, region };
    ranges[nodeIndex] = { key, nodeEnd: nodes.length, leafStart, leafEnd: leaves.length, splits: splitCount - splitsBefore, pieceIds: myPieceIds };
    byKey.set(key, nodeIndex);
    return nodeIndex;
  };

  const boundsKey = exactKey([...g.coords(ctx.bounds.min), ...g.coords(ctx.bounds.max)]);
  const root = frags.length > 0 ? build(frags, ctx.rootRegion, 0, boundsKey) : addLeaf("solid", ctx.rootRegion, 0);
  const tree: BspTree<D> = { planes: ctx.planes, nodes, leaves, root, bounds: ctx.bounds };
  return { result: treeResult(tree, splitCount, 0), cache: { tree, planeKeys, ranges, byKey, ids, nextId, optionsKey }, reusedNodes };
}

/** Numbers joined exactly: shortest round-trip decimals, and −0 kept apart from 0 (`String(-0)` is "0"). */
function exactKey(xs: readonly number[]): string {
  let out = "";
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    out += (i ? "," : "") + (x === 0 && 1 / x < 0 ? "-0" : String(x));
  }
  return out;
}
