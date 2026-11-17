/**
 * CSG: turns overlapping convex brushes into the boundary "walls" of the
 * empty space.
 *
 *   empty = (∪ room brushes) − (∪ solid brushes)
 *
 * Algorithm (a face-based variant of Quake's `qbsp` CSG step, the 3D version
 * of the 2D edge fragmentation):
 *
 * 1. **Fragment.** Every brush face is cut by the planes of every other brush
 *    whose bounds overlap it, Quake `ClipOutside` style: the part in front of
 *    one of the other brush's planes is definitely outside that brush and is
 *    kept as a piece; the rest continues to the next plane. What survives all
 *    planes lies inside (or on the boundary of) the other brush. After this,
 *    every piece is either fully inside, fully outside, or on the surface of
 *    each other brush, so both of its sides have a uniform classification.
 * 2. **Classify.** For each piece, probe a point a tiny distance in front of
 *    and behind its centre. If exactly one side is empty space the piece is a
 *    wall; it is oriented so the empty side is in front. Pieces internal to
 *    the union (both sides empty) or buried in solid (both sides solid) are
 *    discarded: this is what removes the faces where rooms touch or overlap.
 * 3. **De-duplicate.** Coincident faces of different brushes produce
 *    overlapping coplanar walls (identical ones, or differently fragmented
 *    ones). Coplanar same-facing walls are made disjoint by subtracting the
 *    ones accepted earlier, so every bit of the boundary is covered exactly
 *    once (important for leaf surfaces and export; the BSP alone would not
 *    care, it consumes coplanar walls with a single split).
 *
 * The output boundary is closed (watertight) because it is the boundary of a
 * union of convex polyhedra. Raw, possibly leaky input (imported meshes) skips
 * this module and goes straight to the BSP compiler.
 */

import {
  type Aabb, type Vec3, type Plane3, type Winding,
  Side, aabbOverlaps, addScaled, classifyWinding, clipWinding, edgePlanes, flipPlane, reverseWinding, sameOrientedPlane,
  windingAabb, windingArea, windingCenter, windingPlane,
  MIN_AREA, PROBE_OFFSET,
} from "../math";
import type { Wall as SharedWall } from "../../../shared/core";
import type { Dim3 } from "../geometry";
import { type Brush, brushContains, isStructural } from "../level";

/** A boundary polygon of the empty space: convex, CCW seen from the empty side (its front). */
export type Wall = SharedWall<Dim3>;

/** Point classifier for the CSG result. */
export type EmptySpaceTest = (p: Vec3) => boolean;

/** Builds the empty-space membership test for a set of brushes. */
export function makeEmptySpaceTest(brushes: readonly Brush[]): EmptySpaceTest {
  const rooms = brushes.filter((b) => b.kind === "room");
  const solids = brushes.filter((b) => b.kind === "solid");
  // Strict containment: brush boundaries are never empty on their own; the probes sit off the boundary.
  return (p) => rooms.some((b) => brushContains(b, p, true)) && !solids.some((b) => brushContains(b, p, true));
}

/** Creates a wall from a winding (empty space in front). Returns null for degenerate windings. */
export function makeWall(winding: Winding, sourceId = -1): Wall | null {
  const plane = windingPlane(winding);
  if (!plane || windingArea(winding) < MIN_AREA) return null;
  return { winding, plane, sourceId };
}

/**
 * Faces of the level's detail brushes, from the CSG of **all** brushes (so they are trimmed where
 * they enter other solids or leave the rooms). Structural walls come from {@link buildWalls} over
 * structural brushes only: dropping detail faces from the full CSG would leave holes (e.g. in the
 * floor under a pillar) and the BSP would leak through them.
 */
export function buildDetailWalls(brushes: readonly Brush[]): Wall[] {
  const detail = new Set(brushes.filter((b) => !isStructural(b)).map((b) => b.id));
  return detail.size ? buildWalls(brushes).filter((w) => detail.has(w.sourceId)) : [];
}

/** Computes the walls of the CSG result of `brushes`. */
export function buildWalls(brushes: readonly Brush[]): Wall[] {
  const isEmpty = makeEmptySpaceTest(brushes);
  const pieces: Wall[] = [];

  for (const brush of brushes) {
    for (const face of brush.faces) {
      const faceBox = windingAabb(face.winding);
      let fragments: Winding[] = [face.winding];
      for (const other of brushes) {
        if (other === brush || !aabbOverlaps(faceBox, other.bounds, PROBE_OFFSET)) continue;
        fragments = fragments.flatMap((w) => fragmentByBrush(w, other));
      }
      for (const w of fragments) {
        const wall = classifyPiece(w, face.plane, brush.id, isEmpty);
        if (wall) pieces.push(wall);
      }
    }
  }
  return dedupe(pieces);
}

/**
 * Cuts `w` into pieces that are each either outside `other` or inside its
 * closure (Quake's ClipOutside).
 */
function fragmentByBrush(w: Winding, other: Brush): Winding[] {
  const out: Winding[] = [];
  let rest: Winding | null = w;
  for (const plane of other.planes) {
    const side = classifyWinding(plane, rest);
    if (side === Side.Front) {
      out.push(rest);
      return out; // entirely outside `other`
    }
    if (side === Side.Spanning) {
      const front = clipWinding(rest, plane);
      if (front) out.push(front);
      rest = clipWinding(rest, flipPlane(plane));
      if (!rest) return out;
    }
    // Back or On: still possibly inside, continue with the next plane.
  }
  out.push(rest);
  return out;
}

/** Decides whether a piece separates empty from non-empty space, and orients it. */
function classifyPiece(w: Winding, facePlane: Plane3, brushId: number, isEmpty: EmptySpaceTest): Wall | null {
  if (windingArea(w) < MIN_AREA) return null;
  const c = windingCenter(w);
  const emptyFront = isEmpty(addScaled(c, facePlane.n, PROBE_OFFSET));
  const emptyBack = isEmpty(addScaled(c, facePlane.n, -PROBE_OFFSET));
  if (emptyFront === emptyBack) return null;
  return makeWall(emptyFront ? w : reverseWinding(w), brushId);
}

interface PlaneGroup {
  readonly plane: Plane3;
  readonly accepted: { readonly winding: Winding; readonly box: Aabb }[];
}

/**
 * Makes coplanar same-facing walls disjoint: each wall has the walls accepted
 * before it on the same plane subtracted (convex polygon difference, the 2D
 * analogue of {@link fragmentByBrush} on the plane). Identical walls vanish;
 * overlapping leftovers of coincident brush faces that were fragmented
 * differently are trimmed, so every point of the boundary is covered once.
 */
function dedupe(walls: readonly Wall[]): Wall[] {
  const groups: PlaneGroup[] = [];
  const out: Wall[] = [];
  for (const w of walls) {
    let group = groups.find((g) => sameOrientedPlane(g.plane, w.plane));
    if (!group) groups.push((group = { plane: w.plane, accepted: [] }));

    let pieces: Winding[] = [w.winding];
    const box = windingAabb(w.winding);
    for (const a of group.accepted) {
      if (!aabbOverlaps(box, a.box, PROBE_OFFSET)) continue;
      const inward = edgePlanes(a.winding, group.plane.n);
      pieces = pieces.flatMap((p) => subtractConvex(p, inward));
      if (pieces.length === 0) break;
    }
    for (const p of pieces) {
      const piece = makeWall(p, w.sourceId);
      if (!piece) continue;
      out.push(piece);
      group.accepted.push({ winding: p, box: windingAabb(p) });
    }
  }
  return out;
}

/** The parts of `w` outside the convex region bounded by `inward` planes (coplanar difference). */
function subtractConvex(w: Winding, inward: readonly Plane3[]): Winding[] {
  const out: Winding[] = [];
  let rest: Winding | null = w;
  for (const plane of inward) {
    const outside = clipWinding(rest, flipPlane(plane));
    if (outside) out.push(outside);
    rest = clipWinding(rest, plane);
    if (!rest) return out;
  }
  return out; // `rest` is covered by the subtracted polygon
}
