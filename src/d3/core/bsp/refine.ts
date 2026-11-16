/**
 * The 3D half of empty-leaf refinement (`shared/core/bsp/refine.ts`): deciding
 * whether a wall touches a leaf region, which makes its plane a corner-split
 * candidate.
 */

import { type ConvexPolyhedron, type Vec3, type Winding, lerp, PROBE_OFFSET, signedDistance } from "../math";

/**
 * True if the wall polygon comes within {@link PROBE_OFFSET} of the region:
 * clip it to the region's faces pushed outwards by that tolerance and check
 * that anything (even a single point) is left.
 *
 * Point and edge contacts must count: at a door the cell beside the opening
 * often meets the lintel or jamb wall only along an edge or at a corner, and
 * that wall's plane is exactly the corner split it needs. `clipWinding` drops
 * such near-zero-area remnants as degenerate, so this clips the vertex list
 * directly (Sutherland–Hodgman) with no area check.
 */
export function wallTouchesRegion(w: Winding, region: ConvexPolyhedron): boolean {
  let pts: readonly Vec3[] = w;
  for (const f of region.faces) {
    // Faces point outwards: keep the part with distance <= PROBE_OFFSET.
    const out: Vec3[] = [];
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const da = signedDistance(f.plane, a) - PROBE_OFFSET, db = signedDistance(f.plane, b) - PROBE_OFFSET;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(lerp(a, b, da / (da - db)));
    }
    if (out.length === 0) return false;
    pts = out;
  }
  return true;
}
