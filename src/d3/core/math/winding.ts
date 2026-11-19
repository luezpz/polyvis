/**
 * Windings: planar convex polygons in 3D (Quake's term).
 *
 * Walls, portals and the faces of BSP cells are windings. A winding is a
 * vertex loop, **counter-clockwise when seen from the front** of its plane
 * (right-hand rule: the normal points towards the viewer). This is the 3D
 * counterpart of the oriented 2D `Segment` (a→b with the front on the left).
 */

import { type Vec3, addScaled, cross, distance, dot, lerp, normalize, sub, average } from "./vec3";
import { type Plane3, flipPlane, planeBasis, projectOntoPlane, signedDistance } from "./plane3";
import { type Aabb, aabbFromPoints } from "./aabb";
import { MIN_AREA, MIN_LENGTH, PLANE_EPSILON, Side } from "../../../shared/core/math";

export type Winding = readonly Vec3[];

/**
 * Newell normal: `2 × area × unit normal` for a planar CCW loop. Robust for
 * nearly-degenerate and non-convex loops.
 */
export function newellNormal(w: Winding): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0, n = w.length; i < n; i++) {
    const a = w[i], b = w[(i + 1) % n];
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

/** Unit normal of the winding (ZERO if degenerate). */
export const windingNormal = (w: Winding): Vec3 => normalize(newellNormal(w));

/** Area of a planar winding. */
export function windingArea(w: Winding): number {
  const n = newellNormal(w);
  return 0.5 * Math.hypot(n.x, n.y, n.z);
}

/** Vertex average; for a convex winding this is an interior point. */
export const windingCenter = (w: Winding): Vec3 => average(w);

/** Supporting plane of the winding (front = CCW side), or null if degenerate. */
export function windingPlane(w: Winding): Plane3 | null {
  const n = windingNormal(w);
  if (n.x === 0 && n.y === 0 && n.z === 0) return null;
  return { n, d: dot(n, windingCenter(w)) };
}

export const reverseWinding = (w: Winding): Winding => [...w].reverse();

export const windingAabb = (w: Winding): Aabb => aabbFromPoints(w)!;

/** Classifies a winding against a plane (Front / Back / On / Spanning). */
export function classifyWinding(plane: Plane3, w: Winding, eps = PLANE_EPSILON): Side {
  let front = false, back = false;
  for (const p of w) {
    const s = signedDistance(plane, p);
    if (s > eps) front = true;
    else if (s < -eps) back = true;
    if (front && back) return Side.Spanning;
  }
  return front ? Side.Front : back ? Side.Back : Side.On;
}

/** Signed distances scratch for {@link clipWinding} (grown on demand; not re-entrant, which it never is). */
let clipScratch = new Float64Array(64);

/**
 * Keeps the part of `w` in front of `plane` (Sutherland–Hodgman).
 *
 * - Fully in front (touching allowed) → returned unchanged.
 * - Fully behind **or lying on the plane** → null: for visibility, a portal
 *   that only touches a separating plane cannot be seen through, and a face
 *   on a splitting plane belongs to neither side.
 * - Otherwise the front part; vertices within `eps` of the plane are kept.
 *
 * Returns null if the result is degenerate (area below {@link MIN_AREA}).
 */
export function clipWinding(w: Winding, plane: Plane3, eps = PLANE_EPSILON): Winding | null {
  const n = w.length;
  // Hot loop (flow, CSG, BSP regions): reused scratch + signedDistance inlined (same arithmetic, so same bits).
  if (clipScratch.length < n) clipScratch = new Float64Array(Math.max(n, 2 * clipScratch.length));
  const dist = clipScratch;
  const { x: nx, y: ny, z: nz } = plane.n, pd = plane.d;
  let anyFront = false, anyBack = false;
  for (let i = 0; i < n; i++) {
    const q = w[i];
    const s = nx * q.x + ny * q.y + nz * q.z - pd;
    dist[i] = s;
    if (s > eps) anyFront = true;
    else if (s < -eps) anyBack = true;
  }
  if (!anyFront) return null;
  if (!anyBack) return w;

  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dc = dist[i], dn = dist[j];
    if (dc >= -eps) out.push(w[i]);
    if ((dc > eps && dn < -eps) || (dc < -eps && dn > eps)) out.push(lerp(w[i], w[j], dc / (dc - dn)));
  }
  return sanitizeWinding(out);
}

/** Clips a winding to the front of every plane; null as soon as it vanishes. */
export function clipWindingToPlanes(w: Winding, planes: readonly Plane3[], eps = PLANE_EPSILON): Winding | null {
  let cur: Winding | null = w;
  for (const p of planes) {
    cur = clipWinding(cur, p, eps);
    if (!cur) return null;
  }
  return cur;
}

/** Splits a winding that spans `plane` into its front and back parts (either may be null). */
export function splitWinding(w: Winding, plane: Plane3, eps = PLANE_EPSILON): { front: Winding | null; back: Winding | null } {
  return { front: clipWinding(w, plane, eps), back: clipWinding(w, flipPlane(plane), eps) };
}

/** Removes near-duplicate consecutive vertices; returns null if the winding degenerates. */
export function sanitizeWinding(v: readonly Vec3[]): Winding | null {
  const out: Vec3[] = [];
  for (let i = 0; i < v.length; i++) {
    if (distance(v[i], v[(i + 1) % v.length]) < MIN_LENGTH) continue;
    out.push(v[i]);
  }
  if (out.length < 3 || windingArea(out) < MIN_AREA) return null;
  return out;
}

/**
 * A large square on `plane` centred at the projection of `center`, CCW seen
 * from the front. Clipping it by other planes yields faces of convex
 * polyhedra (the "base winding" of Quake's qbsp).
 */
export function baseWindingForPlane(plane: Plane3, center: Vec3, halfSize: number): Winding {
  const { u, v } = planeBasis(plane);
  const c = projectOntoPlane(plane, center);
  const s = halfSize;
  return [
    addScaled(addScaled(c, u, -s), v, -s),
    addScaled(addScaled(c, u, s), v, -s),
    addScaled(addScaled(c, u, s), v, s),
    addScaled(addScaled(c, u, -s), v, s),
  ];
}

/**
 * Inward-facing planes through the edges of a convex winding, perpendicular to
 * the winding's plane (`normal`). A coplanar point is inside the winding iff it
 * is in front of (or on) all of them.
 */
export function edgePlanes(w: Winding, normal: Vec3): Plane3[] {
  const out: Plane3[] = [];
  for (let i = 0; i < w.length; i++) {
    const a = w[i], b = w[(i + 1) % w.length];
    const n = normalize(cross(normal, sub(b, a)));
    if (n.x === 0 && n.y === 0 && n.z === 0) continue;
    out.push({ n, d: dot(n, a) });
  }
  return out;
}

/**
 * Intersection of two coplanar convex windings, both CCW around `normal`.
 * Returns null if they do not overlap with positive area.
 */
export function intersectCoplanarWindings(a: Winding, b: Winding, normal: Vec3): Winding | null {
  return clipWindingToPlanes(a, edgePlanes(b, normal));
}

/**
 * Ray / winding intersection (two-sided). Returns the ray parameter `t >= 0`
 * of the hit (`origin + dir * t`), or null.
 */
export function rayWinding(origin: Vec3, dir: Vec3, w: Winding, plane: Plane3, maxT = Infinity): number | null {
  const denom = dot(plane.n, dir);
  if (Math.abs(denom) < 1e-12) return null;
  const t = (plane.d - dot(plane.n, origin)) / denom;
  if (t < 0 || t > maxT) return null;
  const p = addScaled(origin, dir, t);
  for (let i = 0; i < w.length; i++) {
    const a = w[i], b = w[(i + 1) % w.length];
    if (dot(cross(sub(b, a), sub(p, a)), plane.n) < -1e-9) return null;
  }
  return t;
}
