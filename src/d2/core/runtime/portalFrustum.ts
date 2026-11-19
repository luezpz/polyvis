/**
 * 2D view cone through a portal segment (phase 4 runtime clipping): the two lines from the eye
 * through the segment's endpoints, each facing the other endpoint, so the wedge beyond the
 * segment is in front of both.
 */

import { type Line2, type Segment, type Vec2, flipLine, lineFromPoints, signedDistance, PLANE_EPSILON } from "../math";

/** Lines of the wedge from `eye` through `seg` (front = inside); null if the eye is collinear with `seg`. */
export function portalFrustum2(eye: Vec2, seg: Segment): Line2[] | null {
  const out: Line2[] = [];
  for (const [p, other] of [[seg.a, seg.b], [seg.b, seg.a]] as const) {
    const line = lineFromPoints(eye, p);
    if (!line) return null; // eye on an endpoint
    const s = signedDistance(line, other);
    if (Math.abs(s) <= PLANE_EPSILON) return null; // edge-on
    out.push(s > 0 ? line : flipLine(line));
  }
  return out;
}
