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

import type { Cell, Dim, Facet, Geometry, Plane } from "../geometry";
import { Side } from "../math";
import type { Wall } from "../wall";
import { type RefineOptions, chooseRefineSplit, refinementEnabled, prepareRefineWalls } from "./refine";
import { type BspLeaf, type BspNode, type BspStats, type BspTree, type ChildRef, type LeafContents, BOUNDS_TAG, leafRef } from "./types";

export interface BspBuildOptions extends RefineOptions {
  /** Cost of each wall split when scoring a candidate splitter. */
  readonly splitWeight: number;
  /** Cost of front/back imbalance (|front − back|) when scoring a splitter. */
  readonly balanceWeight: number;
  /** Margin added around the walls' bounding box to close off leaf regions. */
  readonly boundsMargin: number;
}

interface Fragment<D extends Dim> {
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
 * Builds the tree for `walls` (empty space in front of each).
 * `opts` must be complete; each dimension supplies its own defaults.
 */
export function buildBsp<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], opts: BspBuildOptions): BspBuildResult<D> {
  const planes: Plane<D>[] = [];
  const fragments: Fragment<D>[] = walls.map((w) => ({ winding: w.winding, plane: internPlane(g, planes, w.plane) }));

  const points = walls.flatMap((w) => g.facetPoints(w.winding));
  const bounds = g.expandBounds(g.boundsOf(points) ?? { min: g.zero, max: g.zero }, opts.boundsMargin);
  const rootRegion = g.cellFromBounds(bounds, BOUNDS_TAG);

  const nodes: BspNode<D>[] = [];
  const leaves: BspLeaf<D>[] = [];
  let splitCount = 0;
  let refineSplitCount = 0;
  const refineWalls = refinementEnabled(opts) ? prepareRefineWalls(g, walls) : [];
  let maxDepth = 0;

  const addLeaf = (contents: LeafContents, region: Cell<D> | null, depth: number): ChildRef => {
    leaves.push({ contents, region, depth });
    maxDepth = Math.max(maxDepth, depth);
    return leafRef(leaves.length - 1);
  };

  /** Empty space: either refine it with extra splits or close it off as an empty leaf. */
  const buildEmpty = (region: Cell<D> | null, depth: number): ChildRef => {
    const plane = region && refinementEnabled(opts) ? chooseRefineSplit(g, region, refineWalls, opts) : null;
    if (!plane || !region) return addLeaf("empty", region, depth);
    const planeIndex = internPlane(g, planes, plane);
    refineSplitCount++;
    const nodeIndex = nodes.length;
    nodes.push(null as unknown as BspNode<D>);
    const front = buildEmpty(g.clipCell(region, plane, planeIndex), depth + 1);
    const back = buildEmpty(g.clipCell(region, g.flipPlane(plane), planeIndex), depth + 1);
    nodes[nodeIndex] = { plane: planeIndex, front, back, region };
    return nodeIndex;
  };

  const build = (frags: readonly Fragment<D>[], region: Cell<D> | null, depth: number): ChildRef => {
    const planeIndex = chooseSplitter(g, frags, planes, opts);
    const plane = planes[planeIndex];
    const part = partition(g, frags, planeIndex, planes);
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

  const root = fragments.length > 0 ? build(fragments, rootRegion, 0) : addLeaf("solid", rootRegion, 0);

  const tree: BspTree<D> = { planes, nodes, leaves, root, bounds };
  const emptyLeafCount = leaves.filter((l) => l.contents === "empty").length;
  return {
    tree,
    stats: {
      nodeCount: nodes.length,
      leafCount: leaves.length,
      emptyLeafCount,
      solidLeafCount: leaves.length - emptyLeafCount,
      maxDepth,
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

/** Scores every distinct plane among the fragments and returns the cheapest. */
function chooseSplitter<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], planes: readonly Plane<D>[], opts: BspBuildOptions): number {
  const candidates = [...new Set(frags.map((f) => f.plane))];
  if (candidates.length === 1) return candidates[0];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const planeIndex of candidates) {
    const plane = planes[planeIndex];
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
      if (splits * opts.splitWeight >= bestScore) break;
    }
    const score = splits * opts.splitWeight + Math.abs(front - back) * opts.balanceWeight;
    if (score < bestScore) {
      bestScore = score;
      best = planeIndex;
    }
  }
  return best;
}

/** Distributes fragments to the front/back of a plane, consuming same-facing coplanar ones. */
function partition<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], planeIndex: number, planes: readonly Plane<D>[]): Partition<D> {
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
