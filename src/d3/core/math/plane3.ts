/**
 * Oriented planes.
 *
 * A plane is stored in Hessian normal form: the set of points `p` with
 * `dot(n, p) = d`, where `n` is a unit normal. The half-space the normal points
 * into is the plane's *front*; the other half is its *back*. Every algorithm in
 * the compiler (BSP splitting, portal clipping, antipenumbra separators) works
 * in terms of these planes; this is the 3D counterpart of the 2D `Line2`.
 */

import { type Vec3, addScaled, cross, dot, neg, normalize, scale, sub } from "./vec3";
import { PLANE_EPSILON, Side } from "../../../shared/core/math";

export interface Plane3 {
  /** Unit normal. Points into the front half-space. */
  readonly n: Vec3;
  /** Signed distance of the plane from the origin along `n`. */
  readonly d: number;
}

/**
 * Plane through `a`, `b`, `c` whose front is the side from which the triangle
 * appears counter-clockwise (right-hand rule). Returns null if the points are
 * collinear.
 */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): Plane3 | null {
  const n = normalize(cross(sub(b, a), sub(c, a)));
  if (n.x === 0 && n.y === 0 && n.z === 0) return null;
  return { n, d: dot(n, a) };
}

/** Plane through `p` with (not necessarily unit) normal `normal`. */
export function planeFromPointNormal(p: Vec3, normal: Vec3): Plane3 {
  const n = normalize(normal);
  return { n, d: dot(n, p) };
}

/** Same plane, opposite orientation. */
export const flipPlane = (p: Plane3): Plane3 => ({ n: neg(p.n), d: -p.d });

/** The plane moved by `offset` along its own normal. */
export const offsetPlane = (p: Plane3, offset: number): Plane3 => ({ n: p.n, d: p.d + offset });

/** Signed distance from the plane: positive in front, negative behind. */
export const signedDistance = (p: Plane3, q: Vec3): number => p.n.x * q.x + p.n.y * q.y + p.n.z * q.z - p.d;

/** Orthogonal projection of `q` onto the plane. */
export const projectOntoPlane = (p: Plane3, q: Vec3): Vec3 => addScaled(q, p.n, -signedDistance(p, q));

/** The point of the plane closest to the origin. */
export const planeOrigin = (p: Plane3): Vec3 => scale(p.n, p.d);

export function classifyPoint(p: Plane3, q: Vec3, eps = PLANE_EPSILON): Side {
  const s = signedDistance(p, q);
  if (s > eps) return Side.Front;
  if (s < -eps) return Side.Back;
  return Side.On;
}

/** Classifies a set of points (e.g. a winding's vertices) against a plane. */
export function classifyPoints(p: Plane3, points: readonly Vec3[], eps = PLANE_EPSILON): Side {
  let front = false;
  let back = false;
  for (const q of points) {
    const s = signedDistance(p, q);
    if (s > eps) front = true;
    else if (s < -eps) back = true;
    if (front && back) return Side.Spanning;
  }
  if (front) return Side.Front;
  if (back) return Side.Back;
  return Side.On;
}

/** True if two planes are the same geometric plane (orientation ignored). */
export function samePlane(a: Plane3, b: Plane3, eps = PLANE_EPSILON): boolean {
  const k = dot(a.n, b.n);
  if (Math.abs(Math.abs(k) - 1) > 1e-9 + eps) return false;
  return Math.abs(a.d - Math.sign(k) * b.d) <= eps;
}

/** True if two planes are the same plane with the same orientation. */
export const sameOrientedPlane = (a: Plane3, b: Plane3, eps = PLANE_EPSILON): boolean => dot(a.n, b.n) > 0 && samePlane(a, b, eps);

/**
 * An orthonormal basis `(u, v)` of the plane with `cross(u, v) = n`, so 2D
 * coordinates `(dot(p, u), dot(p, v))` preserve counter-clockwise order as
 * seen from the front.
 */
export function planeBasis(p: Plane3): { readonly u: Vec3; readonly v: Vec3 } {
  const { n } = p;
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  // Seed with the world axis least aligned with the normal.
  const seed: Vec3 = ax <= ay && ax <= az ? { x: 1, y: 0, z: 0 } : ay <= az ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const u = normalize(cross(n, seed));
  const v = cross(n, u);
  return { u, v };
}
