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

interface Partition<D extends Dim> {
  readonly front: Fragment<D>[];
  readonly back: Fragment<D>[];
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
  const bounds = g.expandBounds(g.boundsOf(points) ?? { min: g.zero, max: g.zero }, opts.boundsMargin);
  const rootRegion = g.cellFromBounds(bounds, BOUNDS_TAG);
  const refineWalls = refinementEnabled(opts) ? prepareRefineWalls(g, walls) : [];
  return { planes, fragments, bounds, rootRegion, refineWalls, opts };
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
    const planeIndex = chooseSplitter(g, frags, ctx.planes, opts);
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
  const tree: BspTree<D> = { planes, nodes, leaves, root, bounds: ctx.bounds };
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
 * Distinct planes among the fragments, in first-appearance order (the splitter candidates); with
 * `maxCandidates` = m < count, the m planes at indices ⌊i·count/m⌋ (deterministic sample).
 */
export function splitCandidates<D extends Dim>(frags: readonly Fragment<D>[], maxCandidates = 0): number[] {
  const all = [...new Set(frags.map((f) => f.plane))];
  if (!(maxCandidates > 0) || all.length <= maxCandidates) return all;
  return Array.from({ length: maxCandidates }, (_, i) => all[Math.floor((i * all.length) / maxCandidates)]);
}

/** Best candidate of a {@link scoreSplitters} call; lower `score` is better. */
export interface SplitChoice {
  readonly plane: number;
  readonly score: number;
}

/** Scores every distinct plane among the fragments and returns the cheapest. */
function chooseSplitter<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], planes: readonly Plane<D>[], opts: BspBuildOptions): number {
  const candidates = splitCandidates(frags, opts.maxCandidates);
  return candidates.length === 1 ? candidates[0] : scoreSplitters(g, frags, candidates, planes, opts).plane;
}

/**
 * Scores `candidates` (plane indices, non-empty) against `frags` and returns
 * the first one with the lowest score:
 *   score = splitWeight·splits + balanceWeight·|front − back| − facingWeight·onPlane,
 * `onPlane` = fragments with the candidate's plane id (consumed by the node). Scoring candidate chunks separately and
 * keeping the lowest score (ties: earliest chunk) gives the same choice.
 */
export function scoreSplitters<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], candidates: readonly number[], planes: readonly Plane<D>[], opts: BspBuildOptions): SplitChoice {
  let best = candidates[0];
  let bestScore = Infinity;
  const facing = opts.facingWeight ?? 0;
  const onPlane = new Map<number, number>();
  if (facing) for (const f of frags) onPlane.set(f.plane, (onPlane.get(f.plane) ?? 0) + 1);
  for (const planeIndex of candidates) {
    const plane = planes[planeIndex];
    const bonus = facing * (onPlane.get(planeIndex) ?? 0);
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
    const score = splits * opts.splitWeight + Math.abs(front - back) * opts.balanceWeight - bonus;
    if (score < bestScore) {
      bestScore = score;
      best = planeIndex;
    }
  }
  return { plane: best, score: bestScore };
}

/** Distributes fragments to the front/back of a plane, consuming same-facing coplanar ones. */
export function partition<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], planeIndex: number, planes: readonly Plane<D>[]): Partition<D> {
  const plane = planes[planeIndex];
  const front: Fragment<D>[] = [];
  const back: Fragment<D>[] = [];
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
        if (fw) front.push({ winding: fw, plane: f.plane });
        if (bw) back.push({ winding: bw, plane: f.plane });
        splits++;
        break;
      }
    }
  }
  return { front, back, splits };
}
