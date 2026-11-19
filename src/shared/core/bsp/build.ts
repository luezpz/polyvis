/**
 * Solid-leaf BSP construction from walls.
 *
 * Classic recursive build:
 *
 * 1. Pick a splitter plane among the planes of the remaining wall fragments
 *    (heuristic: few splits, balanced sides).
 * 2. Fragments lying on the splitter and facing the same way are *consumed* by
 *    the node: this is what de-duplicates coplanar walls, so a floor made of
 *    many coplanar pieces only ever produces one split.
 * 3. Others go front/back; fragments spanning the plane are split in two.
 *    Coplanar fragments facing the opposite way go to the back.
 * 4. Recurse. An empty front list yields an *empty* leaf (we are in front of
 *    every wall); an empty back list yields a *solid* leaf.
 *
 * 5. Optionally refine empty leaves with extra non-wall splits (corner
 *    extensions, cell size limits); see `refine.ts`.
 *
 * While recursing, each node carries its convex region (the bounding box
 * clipped by all ancestor planes); leaves keep theirs. Region boundary pieces
 * are tagged with the plane that produced them so portals can be found exactly
 * later.
 */

import type { Bounds, Cell, Dim, Facet, Geometry, Plane } from "../geometry";
import { Side } from "../math";
import type { Wall } from "../wall";
import { balanceQuantum, splitterScore } from "./score";
import { SWEEP_MIN_GROUP, sweepScores } from "./sweep";
import { type RefineOptions, type RefineWall, chooseRefineSplit, refinementEnabled, prepareRefineWalls } from "./refine";
import { type BspLeaf, type BspNode, type BspStats, type BspTree, type ChildRef, type LeafContents, BOUNDS_TAG, isLeafRef, leafRef, refToLeaf } from "./types";

export interface BspBuildOptions extends RefineOptions {
  /** Cost of each wall split when scoring a candidate splitter. */
  readonly splitWeight: number;
  /** Cost of front/back imbalance (|front − back|) when scoring a splitter. */
  readonly balanceWeight: number;
  /** Margin added around the walls' bounding box to close off leaf regions. */
  readonly boundsMargin: number;
  /**
   * Phase 3f: score bonus per wall fragment lying on the candidate plane (the node consumes them, so
   * fewer nodes, leaves and portals follow). 0: off (classic splits + balance score).
   */
  readonly facingWeight?: number;
  /** Phase 3f: score at most this many candidates per node, evenly spaced over them (0 / unset: all). */
  readonly maxCandidates?: number;
}

/** A wall piece still to be placed; `plane` indexes the tree's planes (always a wall plane). */
export interface Fragment<D extends Dim> {
  readonly winding: Facet<D>;
  readonly plane: number;
}

interface Partition<F> {
  readonly front: F[];
  readonly back: F[];
  readonly splits: number;
}

export interface BspBuildResult<D extends Dim> {
  readonly tree: BspTree<D>;
  readonly stats: BspStats;
}

/**
 * Everything a subtree build needs, identical on every thread. `planes` holds
 * the interned wall planes; refinement planes a subtree adds get indices
 * `planes.length + k` (k = position in {@link Subtree.newPlanes}).
 */
export interface BuildContext<D extends Dim> {
  readonly planes: readonly Plane<D>[];
  readonly fragments: readonly Fragment<D>[];
  readonly bounds: Bounds<D>;
  readonly rootRegion: Cell<D>;
  readonly refineWalls: readonly RefineWall<D>[];
  readonly opts: BspBuildOptions;
  /** `planeRank[i]`: position of wall plane i in canonical order ({@link planeRanks}); splitter ties go to the lowest. */
  readonly planeRank: Int32Array;
}

/**
 * Work for one independent subtree: wall fragments still to place, an empty
 * region (refinement only), or a solid region (a single leaf).
 */
export type SubtreeTask<D extends Dim> =
  | { readonly kind: "walls"; readonly frags: readonly Fragment<D>[]; readonly region: Cell<D> | null; readonly depth: number }
  | { readonly kind: "empty" | "solid"; readonly region: Cell<D> | null; readonly depth: number };

/**
 * A subtree in local numbering: `nodes` / `leaves` in the order the
 * sequential build would emit them (preorder, front first), child refs local,
 * plane indices and region tags `>= ctx.planes.length` local to `newPlanes`.
 */
export interface Subtree<D extends Dim> {
  readonly newPlanes: readonly Plane<D>[];
  readonly nodes: readonly BspNode<D>[];
  readonly leaves: readonly BspLeaf<D>[];
  readonly root: ChildRef;
  readonly splitCount: number;
  readonly refineSplitCount: number;
}

/**
 * Top of a tree built elsewhere: wall-split nodes (in global plane numbering,
 * which only uses wall planes) down to finished subtrees. `splits` = wall
 * fragments split at that node.
 */
export type Skeleton<D extends Dim> =
  | { readonly kind: "node"; readonly plane: number; readonly region: Cell<D> | null; readonly splits: number; readonly front: Skeleton<D>; readonly back: Skeleton<D> }
  | { readonly kind: "subtree"; readonly tree: Subtree<D> };

/**
 * Builds the tree for `walls` (empty space in front of each).
 * `opts` must be complete; each dimension supplies its own defaults.
 * See `parallelBuild.ts` for the multi-threaded version (same result).
 */
export function buildBsp<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], opts: BspBuildOptions): BspBuildResult<D> {
  const ctx = prepareBuild(g, walls, opts);
  return assembleTree(g, ctx, { kind: "subtree", tree: buildSubtree(g, ctx, rootTask(ctx)) });
}

/** Interns the wall planes and computes the bounds and root region. */
export function prepareBuild<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], opts: BspBuildOptions): BuildContext<D> {
  const planes: Plane<D>[] = [];
  const fragments: Fragment<D>[] = walls.map((w) => ({ winding: w.winding, plane: internPlane(g, planes, w.plane) }));
  const points = walls.flatMap((w) => g.facetPoints(w.winding));
  const bounds = snapBounds(g, g.expandBounds(g.boundsOf(points) ?? { min: g.zero, max: g.zero }, opts.boundsMargin));
  const rootRegion = g.cellFromBounds(bounds, BOUNDS_TAG);
  const refineWalls = refinementEnabled(opts) ? prepareRefineWalls(g, walls) : [];
  return { planes, fragments, bounds, rootRegion, refineWalls, opts, planeRank: planeRanks(g, planes) };
}

/** Bounds snap to multiples of (power of two ≥ largest extent) / this; see {@link snapBounds}. */
const BOUNDS_GRID_STEPS = 16;

/**
 * Grows `box` outward to a coarse grid of step q = 2^⌈log2 E⌉ / 16 (E = largest extent):
 * min → q·(⌊min/q + ½⌋ − 1), max → q·(⌈max/q − ½⌉ + 1), so at least q/2 is added on each side.
 * Every region is the root box clipped by its ancestors, and clipping interpolates along the box
 * edges, so moving the box changes every leaf's numbers (and with them every portal's exact key,
 * see `vis/portalMatch.ts`). Snapped, an edit only moves the bounds when it crosses a half-grid
 * line; authored levels sit on the grid (min − margin is usually a multiple of q), so the jumps are
 * off their coordinates (phase 3.5, stable BSP).
 */
export function snapBounds<D extends Dim>(g: Geometry<D>, box: Bounds<D>): Bounds<D> {
  const lo = g.coords(box.min), hi = g.coords(box.max);
  const extent = Math.max(...hi.map((h, i) => h - lo[i]));
  if (!(extent > 0)) return box;
  const q = 2 ** Math.ceil(Math.log2(extent)) / BOUNDS_GRID_STEPS;
  const at = (c: number[]): D["vec"] => g.vecAt(c, 0);
  return { min: at(lo.map((x) => (Math.floor(x / q + 0.5) - 1) * q)), max: at(hi.map((x) => (Math.ceil(x / q - 0.5) + 1) * q)) };
}

/**
 * `rank[i]` = position of `planes[i]` when sorted by (n coordinates, d), compared exactly.
 * Splitter candidates are scanned in this order, so the choice (lowest score, ties to the lowest
 * rank) depends only on the fragments' geometry, not on wall order or plane numbering.
 */
export function planeRanks<D extends Dim>(g: Geometry<D>, planes: readonly Plane<D>[]): Int32Array {
  const keys = planes.map((p) => [...g.coords(p.n), p.d]);
  const order = planes.map((_, i) => i).sort((a, b) => {
    const ka = keys[a], kb = keys[b];
    for (let k = 0; k < ka.length; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k];
    return a - b;
  });
  const rank = new Int32Array(planes.length);
  order.forEach((p, r) => (rank[p] = r));
  return rank;
}

/** The task for the whole tree. */
export function rootTask<D extends Dim>(ctx: BuildContext<D>): SubtreeTask<D> {
  return ctx.fragments.length > 0
    ? { kind: "walls", frags: ctx.fragments, region: ctx.rootRegion, depth: 0 }
    : { kind: "solid", region: ctx.rootRegion, depth: 0 };
}

/** Builds one subtree (the classic recursion of the module docs) in local numbering. */
export function buildSubtree<D extends Dim>(g: Geometry<D>, ctx: BuildContext<D>, task: SubtreeTask<D>): Subtree<D> {
  const { opts } = ctx;
  const newPlanes: Plane<D>[] = [];
  const nodes: BspNode<D>[] = [];
  const leaves: BspLeaf<D>[] = [];
  let splitCount = 0;
  let refineSplitCount = 0;
  const planeAt = (i: number): Plane<D> => (i < ctx.planes.length ? ctx.planes[i] : newPlanes[i - ctx.planes.length]);

  /** Same lookup order as interning into one global list: wall planes, then this subtree's. */
  const intern = (plane: Plane<D>): number => {
    const i = ctx.planes.findIndex((p) => g.sameOrientedPlane(p, plane));
    if (i >= 0) return i;
    return ctx.planes.length + internPlane(g, newPlanes, plane);
  };

  const addLeaf = (contents: LeafContents, region: Cell<D> | null, depth: number): ChildRef => {
    leaves.push({ contents, region, depth });
    return leafRef(leaves.length - 1);
  };

  /** Empty space: either refine it with extra splits or close it off as an empty leaf. */
  const buildEmpty = (region: Cell<D> | null, depth: number): ChildRef => {
    const plane = region && refinementEnabled(opts) ? chooseRefineSplit(g, region, ctx.refineWalls, opts) : null;
    if (!plane || !region) return addLeaf("empty", region, depth);
    const planeIndex = intern(plane);
    refineSplitCount++;
    const nodeIndex = nodes.length;
    nodes.push(null as unknown as BspNode<D>);
    const front = buildEmpty(g.clipCell(region, plane, planeIndex), depth + 1);
    const back = buildEmpty(g.clipCell(region, g.flipPlane(plane), planeIndex), depth + 1);
    nodes[nodeIndex] = { plane: planeIndex, front, back, region };
    return nodeIndex;
  };

  const build = (frags: readonly Fragment<D>[], region: Cell<D> | null, depth: number): ChildRef => {
    const planeIndex = chooseSplitter(g, frags, ctx);
    const plane = planeAt(planeIndex);
    const part = partition(g, frags, planeIndex, ctx.planes);
    splitCount += part.splits;

    // Reserve the node slot first so parents get lower indices than children (nicer for export/debugging).
    const nodeIndex = nodes.length;
    nodes.push(null as unknown as BspNode<D>);
    const frontRegion = region && g.clipCell(region, plane, planeIndex);
    const backRegion = region && g.clipCell(region, g.flipPlane(plane), planeIndex);
    const front = part.front.length > 0 ? build(part.front, frontRegion, depth + 1) : buildEmpty(frontRegion, depth + 1);
    const back = part.back.length > 0 ? build(part.back, backRegion, depth + 1) : addLeaf("solid", backRegion, depth + 1);
    nodes[nodeIndex] = { plane: planeIndex, front, back, region };
    return nodeIndex;
  };

  const root = task.kind === "walls" ? build(task.frags, task.region, task.depth)
    : task.kind === "empty" ? buildEmpty(task.region, task.depth)
    : addLeaf("solid", task.region, task.depth);
  return { newPlanes, nodes, leaves, root, splitCount, refineSplitCount };
}

/**
 * Flattens a skeleton into a tree, splicing subtrees in preorder (front
 * first) so node, leaf and plane numbering match the sequential build: each
 * subtree's new planes are interned into the global list in their creation
 * order, and its plane indices, region tags and child refs are shifted.
 */
export function assembleTree<D extends Dim>(g: Geometry<D>, ctx: BuildContext<D>, skeleton: Skeleton<D>): BspBuildResult<D> {
  const planes: Plane<D>[] = [...ctx.planes];
  const base = ctx.planes.length;
  const nodes: BspNode<D>[] = [];
  const leaves: BspLeaf<D>[] = [];
  let splitCount = 0;
  let refineSplitCount = 0;

  const splice = (t: Subtree<D>): ChildRef => {
    const planeMap = t.newPlanes.map((p) => internPlane(g, planes, p));
    const identity = planeMap.every((m, k) => m === base + k);
    const tag = (i: number): number => (i >= base ? planeMap[i - base] : i);
    const region = (c: Cell<D> | null): Cell<D> | null => (c && !identity ? g.retagCell(c, tag) : c);
    const nodeBase = nodes.length, leafBase = leaves.length;
    const ref = (r: ChildRef): ChildRef => (isLeafRef(r) ? leafRef(refToLeaf(r) + leafBase) : r + nodeBase);
    for (const n of t.nodes) nodes.push({ plane: tag(n.plane), front: ref(n.front), back: ref(n.back), region: region(n.region) });
    for (const l of t.leaves) leaves.push(identity ? l : { ...l, region: region(l.region) });
    splitCount += t.splitCount;
    refineSplitCount += t.refineSplitCount;
    return ref(t.root);
  };

  const walk = (s: Skeleton<D>): ChildRef => {
    if (s.kind === "subtree") return splice(s.tree);
    splitCount += s.splits;
    const nodeIndex = nodes.length;
    nodes.push(null as unknown as BspNode<D>);
    const front = walk(s.front);
    const back = walk(s.back);
    nodes[nodeIndex] = { plane: s.plane, front, back, region: s.region };
    return nodeIndex;
  };

  const root = walk(skeleton);
  return treeResult({ planes, nodes, leaves, root, bounds: ctx.bounds }, splitCount, refineSplitCount);
}

/** Pairs a finished tree with its {@link BspStats}. */
export function treeResult<D extends Dim>(tree: BspTree<D>, splitCount: number, refineSplitCount: number): BspBuildResult<D> {
  const { nodes, leaves } = tree;
  const emptyLeafCount = leaves.filter((l) => l.contents === "empty").length;
  return {
    tree,
    stats: {
      nodeCount: nodes.length,
      leafCount: leaves.length,
      emptyLeafCount,
      solidLeafCount: leaves.length - emptyLeafCount,
      maxDepth: leaves.reduce((m, l) => Math.max(m, l.depth), 0),
      splitCount,
      refineSplitCount,
    },
  };
}

/** Returns the index of an existing identically-oriented plane, or adds a new one. */
function internPlane<D extends Dim>(g: Geometry<D>, planes: Plane<D>[], plane: Plane<D>): number {
  const i = planes.findIndex((p) => g.sameOrientedPlane(p, plane));
  if (i >= 0) return i;
  planes.push(plane);
  return planes.length - 1;
}

/**
 * Distinct planes among the fragments (the splitter candidates), sorted by `rank` (see
 * {@link planeRanks}); with `maxCandidates` = m < count, the m planes at indices ⌊i·count/m⌋
 * (deterministic sample).
 */
export function splitCandidates<D extends Dim>(frags: readonly Fragment<D>[], rank: Int32Array, maxCandidates = 0): number[] {
  const all = [...new Set(frags.map((f) => f.plane))].sort((a, b) => rank[a] - rank[b]);
  if (!(maxCandidates > 0) || all.length <= maxCandidates) return all;
  return Array.from({ length: maxCandidates }, (_, i) => all[Math.floor((i * all.length) / maxCandidates)]);
}

/** Best candidate of a {@link scoreSplitters} call; lower `score` is better. */
export interface SplitChoice {
  readonly plane: number;
  readonly score: number;
}

/** Scores every distinct plane among the fragments (non-empty) and returns the cheapest (an index into `ctx.planes`). */
export function chooseSplitter<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], ctx: BuildContext<D>): number {
  const candidates = splitCandidates(frags, ctx.planeRank, ctx.opts.maxCandidates);
  return candidates.length === 1 ? candidates[0] : scoreSplitters(g, frags, candidates, ctx.planes, ctx.opts).plane;
}

/**
 * Scores `candidates` (plane indices, non-empty) against `frags` and returns
 * the first one with the lowest {@link splitterScore}; `onPlane` = fragments with the candidate's
 * plane id (consumed by the node). Scoring candidate chunks separately and
 * keeping the lowest score (ties: earliest chunk) gives the same choice.
 * `useSweep` (default true): score large groups of parallel candidates at once (`sweep.ts`, exact: same scores);
 * false keeps the per-candidate loop (reference for tests).
 */
export function scoreSplitters<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], candidates: readonly number[], planes: readonly Plane<D>[], opts: BspBuildOptions, useSweep = true): SplitChoice {
  let best = candidates[0];
  let bestScore = Infinity;
  const facing = opts.facingWeight ?? 0;
  const q = balanceQuantum(frags.length);
  const onPlane = new Map<number, number>();
  if (facing) for (const f of frags) onPlane.set(f.plane, (onPlane.get(f.plane) ?? 0) + 1);
  const swept = useSweep && candidates.length >= SWEEP_MIN_GROUP ? sweepScores(g, frags, candidates, planes, opts) : null;
  for (const planeIndex of candidates) {
    const known = swept?.get(planeIndex);
    if (known !== undefined) {
      if (known < bestScore) {
        bestScore = known;
        best = planeIndex;
      }
      continue;
    }
    const plane = planes[planeIndex];
    const own = onPlane.get(planeIndex) ?? 0;
    const bonus = facing * own;
    let front = 0, back = 0, splits = 0;
    for (const f of frags) {
      if (f.plane === planeIndex) continue;
      switch (g.classifyFacet(plane, f.winding)) {
        case Side.Front: front++; break;
        case Side.Back: back++; break;
        case Side.Spanning: splits++; front++; back++; break;
        case Side.On: if (g.dot(planes[f.plane].n, plane.n) < 0) back++; break;
      }
      // Early out: this candidate can no longer beat the best one.
      if (splits * opts.splitWeight - bonus >= bestScore) break;
    }
    const score = splitterScore(splits, front, back, own, q, opts);
    if (score < bestScore) {
      bestScore = score;
      best = planeIndex;
    }
  }
  return { plane: best, score: bestScore };
}

/** Distributes fragments to the front/back of a plane, consuming same-facing coplanar ones. */
export function partition<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], planeIndex: number, planes: readonly Plane<D>[]): Partition<Fragment<D>> {
  return partitionWith(g, frags, planeIndex, planes, (f, winding) => ({ winding, plane: f.plane }));
}

/**
 * {@link partition} over any fragment type: unsplit fragments are passed through as is, the two
 * sides of a split `parent` are made by `piece(parent, winding, front)` (front side first).
 */
export function partitionWith<D extends Dim, F extends Fragment<D>>(
  g: Geometry<D>, frags: readonly F[], planeIndex: number, planes: readonly Plane<D>[], piece: (parent: F, winding: Facet<D>, front: boolean) => F,
): Partition<F> {
  const plane = planes[planeIndex];
  const front: F[] = [];
  const back: F[] = [];
  let splits = 0;
  for (const f of frags) {
    if (f.plane === planeIndex) continue; // consumed by this node
    switch (g.classifyFacet(plane, f.winding)) {
      case Side.Front: front.push(f); break;
      case Side.Back: back.push(f); break;
      case Side.On:
        if (g.dot(planes[f.plane].n, plane.n) < 0) back.push(f); // opposite-facing coplanar wall
        break; // same-facing coplanar (different plane id within tolerance): consumed
      case Side.Spanning: {
        const fw = g.clipFacet(f.winding, plane);
        const bw = g.clipFacet(f.winding, g.flipPlane(plane));
        if (fw) front.push(piece(f, fw, true));
        if (bw) back.push(piece(f, bw, false));
        splits++;
        break;
      }
    }
  }
  return { front, back, splits };
}
