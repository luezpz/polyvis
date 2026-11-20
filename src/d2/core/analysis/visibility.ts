/**
 * Exact point visibility (ground truth), used to visualise and validate the
 * PVS: the PVS of a leaf must contain every leaf this polygon touches, for
 * every viewpoint inside the leaf.
 */

import { type Vec2, type Segment, type Line2, PARALLEL_EPSILON, addScaled, cross, normalize, sub, segmentIntersection } from "../math";
import type { Wall } from "../csg";

/** Line-of-sight oracle: a hit within this of a wall end (segment parameter) counts as blocked (strict tests). */
const LOS_PARAM_EPSILON = 1e-6;
/** Visibility polygon: angular offset (radians) of the rays cast either side of each wall endpoint. */
const CORNER_RAY_OFFSET = 1e-5;

/** Closest wall hit along a ray (same shape as the 3D `RayHit`). */
export interface RayHit {
  /** Distance along the (unit) direction. */
  readonly t: number;
  readonly point: Vec2;
  /** Index of the wall that was hit. */
  readonly wall: number;
}

/**
 * Casts a ray against all walls (two-sided). `dir` need not be unit.
 * Returns the nearest hit within `maxDistance`, or null.
 */
export function castRay(walls: readonly { readonly winding: Segment; readonly plane: Line2 }[], origin: Vec2, dir: Vec2, maxDistance = Infinity): RayHit | null {
  const d = normalize(dir);
  let best = maxDistance;
  let wall = -1;
  walls.forEach((w, i) => {
    const t = rayHit(origin, d, w.winding);
    if (t !== null && t < best) {
      best = t;
      wall = i;
    }
  });
  return wall < 0 ? null : { t: best, point: addScaled(origin, d, best), wall };
}

/**
 * True if the open segment p→q does not touch any wall. Touching a wall end
 * (within {@link LOS_PARAM_EPSILON} in parameter space) counts as blocked, which keeps the
 * conservativeness tests on the safe side.
 */
export function lineOfSight(walls: readonly Wall[], p: Vec2, q: Vec2): boolean {
  return !walls.some((w) => segmentIntersection(p, q, w.winding.a, w.winding.b, LOS_PARAM_EPSILON) !== null);
}

/**
 * Visibility polygon of `origin` among `walls`, by angular ray casting.
 * Rays are cast towards every wall endpoint (±ε) plus `extraRays` evenly spaced
 * directions, so corners are captured exactly. Rays travel at most `maxDistance`.
 * Returns the hit points sorted by angle (a star-shaped polygon around `origin`).
 */
export function visibilityPolygon(walls: readonly Segment[], origin: Vec2, maxDistance: number, extraRays = 64): Vec2[] {
  const angles: number[] = [];
  const eps = CORNER_RAY_OFFSET;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x);
      angles.push(a - eps, a, a + eps);
    }
  }
  for (let i = 0; i < extraRays; i++) angles.push(-Math.PI + (i / extraRays) * Math.PI * 2);
  angles.sort((x, y) => x - y);

  const out: Vec2[] = [];
  for (const angle of angles) {
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    let best = maxDistance;
    for (const w of walls) {
      const t = rayHit(origin, dir, w);
      if (t !== null && t < best) best = t;
    }
    out.push({ x: origin.x + dir.x * best, y: origin.y + dir.y * best });
  }
  return out;
}

/** Distance along the ray to segment `s`, or null if missed. */
function rayHit(o: Vec2, d: Vec2, s: Segment): number | null {
  const e = sub(s.b, s.a);
  const denom = cross(d, e);
  if (Math.abs(denom) < PARALLEL_EPSILON) return null;
  const ao = sub(s.a, o);
  const t = cross(ao, e) / denom;
  const u = cross(ao, d) / denom;
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}
