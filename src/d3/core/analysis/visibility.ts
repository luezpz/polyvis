/**
 * Exact point-to-point visibility (ground truth), used to visualise and
 * validate the PVS: whenever two points can see each other, the PVS row of
 * the first point's leaf must contain the second point's leaf.
 */

import { type Vec3, type Winding, type Plane3, addScaled, dot, normalize, sub, rayWinding, distance, aabbOverlaps, aabbFromPoints } from "../math";
import type { Wall } from "../csg";

/** Closest wall hit along a ray. */
export interface RayHit {
  /** Distance along the (unit) direction. */
  readonly t: number;
  readonly point: Vec3;
  /** Index of the wall that was hit. */
  readonly wall: number;
}

/** Casts a ray against all walls (two-sided). Returns the nearest hit within `maxDistance`, or null. */
export function castRay(walls: readonly { readonly winding: Winding; readonly plane: Plane3 }[], origin: Vec3, dir: Vec3, maxDistance = Infinity): RayHit | null {
  const d = normalize(dir);
  let best = maxDistance;
  let wall = -1;
  walls.forEach((w, i) => {
    const t = rayWinding(origin, d, w.winding, w.plane, best);
    if (t !== null && t < best) {
      best = t;
      wall = i;
    }
  });
  return wall < 0 ? null : { t: best, point: addScaled(origin, d, best), wall };
}

/** True if the open segment p→q does not touch any wall. */
export function lineOfSight(walls: readonly Wall[], p: Vec3, q: Vec3): boolean {
  const len = distance(p, q);
  if (len === 0) return true;
  const box = aabbFromPoints([p, q])!;
  const dir = sub(q, p);
  for (const w of walls) {
    // Cheap rejects: both endpoints strictly on the same side of the wall plane.
    const sp = dot(w.plane.n, p) - w.plane.d;
    const sq = dot(w.plane.n, q) - w.plane.d;
    if ((sp > 0 && sq > 0) || (sp < 0 && sq < 0)) continue;
    if (!aabbOverlaps(box, aabbFromPoints(w.winding)!, 1e-9)) continue;
    const t = rayWinding(p, dir, w.winding, w.plane, 1);
    if (t !== null) return false;
  }
  return true;
}

/** `count` roughly uniform unit directions (Fibonacci sphere). */
export function sphereDirections(count: number): Vec3[] {
  const out: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - z * z);
    const a = golden * i;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z });
  }
  return out;
}
