/**
 * Empty-leaf refinement: extra, non-wall splits applied to empty leaves after
 * the solid-leaf build has used up every wall.
 *
 * A plain solid-leaf BSP only splits space along wall planes, and each plane
 * only cuts the node region it was chosen in. Around a convex solid corner (a
 * reflex vertex/edge of the empty space: pillar corners, door jambs and
 * lintels, the lip of a balcony, the inner corner of an L) one of the two
 * walls usually gets extended into the room and the other does not, so a
 * single big leaf wraps around the corner and the PVS of everything in it is
 * the union of what can be seen from both sides.
 *
 * Two refinements fix that:
 *
 * 1. **Corner splits.** For each empty leaf, every wall that touches the
 *    leaf's closure and whose plane passes through the leaf's interior is a
 *    candidate splitter: the plane is the wall's extension past the corner it
 *    shares with the leaf. These are the planes where the view "around the
 *    corner" changes (a subset of the visibility event surfaces of Teller's
 *    analysis), so cells that end on them get much tighter PVS rows. Quake's
 *    `qbsp` gets a similar effect for free from splitting by every brush face.
 *    (2D: "touches" means a wall endpoint lies in the leaf; 3D: the wall
 *    polygon comes within tolerance of it. See `Geometry.wallTouchesCell`.)
 * 2. **Cell size limits.** Empty leaves larger than `maxCellSize` along any
 *    axis are halved by an axis-aligned plane (like `qbsp`'s block grid), and
 *    no refinement split may create a cell thinner than `minCellSize` along
 *    the split normal, which keeps corner splits from producing slivers.
 *
 * Refinement never changes what is solid or empty, it only subdivides empty
 * leaves, so the PVS stays conservative; it just has more, smaller cells.
 */

import type { Bounds, Cell, Dim, Facet, Geometry, Plane, Vec } from "../geometry";
import { PROBE_OFFSET } from "../math";
import type { Wall } from "../wall";

export interface RefineOptions {
  /** Split empty leaves along the extensions of walls that touch them (see module docs). */
  readonly cornerSplits: boolean;
  /**
   * Refinement splits that would leave either side thinner than this (measured
   * along the split normal, world units) are rejected. 0 disables the limit.
   * Does not affect wall splits.
   */
  readonly minCellSize: number;
  /** Empty leaves larger than this along any axis are halved by axis-aligned splits. 0 disables. */
  readonly maxCellSize: number;
}

/** A wall prepared for refinement queries. */
export interface RefineWall<D extends Dim> {
  readonly winding: Facet<D>;
  readonly plane: Plane<D>;
  readonly box: Bounds<D>;
}

/** Caches each wall's bounding box for the candidate search of {@link chooseRefineSplit}. */
export function prepareRefineWalls<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[]): RefineWall<D>[] {
  return walls.map((w) => ({ winding: w.winding, plane: w.plane, box: g.boundsOf(g.facetPoints(w.winding))! }));
}

/** True if any refinement is enabled (so the builder can skip the work entirely). */
export function refinementEnabled(opts: RefineOptions): boolean {
  return opts.cornerSplits || opts.maxCellSize > 0;
}

/**
 * Picks the next refinement splitter for an empty leaf region, or null if the
 * leaf should stay as it is.
 *
 * Corner splits come first; among them the most balanced one wins (largest
 * thinner side), which keeps cells compact. Only when no corner split applies
 * is the size limit enforced. Termination: a plane that already bounds or cut
 * an ancestor region cannot span a descendant, so each wall plane is used at
 * most once per path; size splits halve the region's extent.
 */
export function chooseRefineSplit<D extends Dim>(g: Geometry<D>, region: Cell<D>, walls: readonly RefineWall<D>[], opts: RefineOptions): Plane<D> | null {
  const vertices = g.cellVertices(region);
  const box = g.boundsOf(vertices);
  if (!box) return null;

  // Never cut slivers thinner than the probe offset, even with no minimum set.
  const minThickness = Math.max(opts.minCellSize, PROBE_OFFSET);
  if (opts.cornerSplits) {
    let best: Plane<D> | null = null;
    let bestThickness = 0;
    for (const w of walls) {
      if (!g.boundsOverlap(box, w.box, PROBE_OFFSET)) continue;
      // Cheap test first: the wall plane must cut the region into two sufficiently thick parts.
      const t = splitThickness(g, vertices, w.plane);
      if (t <= bestThickness || t < minThickness) continue;
      if (!g.wallTouchesCell(w.winding, region)) continue;
      best = w.plane;
      bestThickness = t;
    }
    if (best) return best;
  }

  if (opts.maxCellSize > 0) {
    const lo = g.coords(box.min), hi = g.coords(box.max);
    // Longest axis; ties go to the lower axis.
    let axis = 0;
    for (let i = 1; i < g.dimension; i++) if (hi[i] - lo[i] > hi[axis] - lo[axis]) axis = i;
    const size = hi[axis] - lo[axis];
    if (size > opts.maxCellSize && size / 2 >= minThickness) return g.axisPlane(axis, (lo[axis] + hi[axis]) / 2);
  }
  return null;
}

/**
 * Thickness of the thinner side when `plane` splits a region with the given
 * vertices: min over sides of the farthest vertex distance (0 if the plane
 * does not cut through it).
 */
function splitThickness<D extends Dim>(g: Geometry<D>, vertices: readonly Vec<D>[], plane: Plane<D>): number {
  let front = 0, back = 0;
  for (const p of vertices) {
    const s = g.signedDistance(plane, p);
    if (s > front) front = s;
    if (-s > back) back = -s;
  }
  return Math.min(front, back);
}
