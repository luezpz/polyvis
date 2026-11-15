/**
 * The 3D half of empty-leaf refinement (`shared/core/bsp/refine.ts`): deciding
 * whether a wall touches a leaf region, which makes its plane a corner-split
 * candidate.
 */

import { type ConvexPolyhedron, type Winding, clipWinding, flipPlane, offsetPlane, PROBE_OFFSET } from "../math";

/**
 * True if the wall polygon comes within {@link PROBE_OFFSET} of the region:
 * clip it to the region's faces pushed outwards by that tolerance.
 */
export function wallTouchesRegion(w: Winding, region: ConvexPolyhedron): boolean {
  let cur: Winding | null = w;
  for (const f of region.faces) {
    cur = clipWinding(cur, flipPlane(offsetPlane(f.plane, PROBE_OFFSET)));
    if (!cur) return false;
  }
  return true;
}
