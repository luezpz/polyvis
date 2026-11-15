/**
 * The 2D half of empty-leaf refinement (`shared/core/bsp/refine.ts`): deciding
 * whether a wall touches a leaf region, which makes its line a corner-split
 * candidate.
 */

import { type ConvexPolygon, type Segment, aabbContains, aabbFromPoints, convexContains, PLANE_EPSILON } from "../math";

/**
 * True if an endpoint of the wall lies in the (closed) region. Walls never
 * cross the interior of an empty leaf, so a wall whose line cuts through the
 * leaf touches it exactly when it ends on it: at a corner the leaf wraps around.
 */
export function wallTouchesRegion(w: Segment, region: ConvexPolygon): boolean {
  const box = aabbFromPoints(region.vertices);
  if (!box) return false;
  const inRegion = (p: Segment["a"]): boolean => aabbContains(box, p, PLANE_EPSILON) && convexContains(region.vertices, p, false);
  return inRegion(w.a) || inRegion(w.b);
}
