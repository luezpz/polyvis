/**
 * Convex polyhedra with per-face tags: the 3D counterpart of the 2D tagged
 * `ConvexPolygon`.
 *
 * BSP cells are convex polyhedra produced by repeatedly clipping a bounding
 * box with splitting planes. Each face remembers *which* plane produced it
 * (its `tag`, usually a BSP plane index). Two cells can only share a portal
 * across faces with the same tag, which makes portal discovery exact without
 * fuzzy coplanarity tests.
 *
 * Face planes point **outwards**; face windings are CCW seen from outside.
 */

import { type Vec3, cross, dot, sub, average } from "./vec3";
import { type Plane3, flipPlane, signedDistance } from "./plane3";
import { type Winding, baseWindingForPlane, clipWinding } from "./winding";
import { type Aabb, aabbFromPoints, aabbCenter, aabbDiagonal } from "./aabb";
import { MIN_VOLUME, PLANE_EPSILON } from "../../../shared/core/math";

/** Tag used for faces that do not originate from any known plane. */
export const NO_TAG = -1;

export interface PolyFace {
  /** Supporting plane, normal pointing out of the polyhedron. */
  readonly plane: Plane3;
  /** Face polygon, CCW seen from outside. */
  readonly winding: Winding;
  /** Identifies the plane that produced this face (e.g. a BSP plane index). */
  readonly tag: number;
}

export interface ConvexPolyhedron {
  readonly faces: readonly PolyFace[];
}

/** Box polyhedron. Face order: -x, +x, -y, +y, -z, +z. */
export function polyhedronFromAabb(b: Aabb, tag: number = NO_TAG): ConvexPolyhedron {
  const { min: l, max: h } = b;
  const p = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
  const face = (n: Vec3, d: number, winding: Vec3[]): PolyFace => ({ plane: { n, d }, winding, tag });
  return {
    faces: [
      face({ x: -1, y: 0, z: 0 }, -l.x, [p(l.x, l.y, l.z), p(l.x, l.y, h.z), p(l.x, h.y, h.z), p(l.x, h.y, l.z)]),
      face({ x: 1, y: 0, z: 0 }, h.x, [p(h.x, l.y, l.z), p(h.x, h.y, l.z), p(h.x, h.y, h.z), p(h.x, l.y, h.z)]),
      face({ x: 0, y: -1, z: 0 }, -l.y, [p(l.x, l.y, l.z), p(h.x, l.y, l.z), p(h.x, l.y, h.z), p(l.x, l.y, h.z)]),
      face({ x: 0, y: 1, z: 0 }, h.y, [p(l.x, h.y, l.z), p(l.x, h.y, h.z), p(h.x, h.y, h.z), p(h.x, h.y, l.z)]),
      face({ x: 0, y: 0, z: -1 }, -l.z, [p(l.x, l.y, l.z), p(l.x, h.y, l.z), p(h.x, h.y, l.z), p(h.x, l.y, l.z)]),
      face({ x: 0, y: 0, z: 1 }, h.z, [p(l.x, l.y, h.z), p(h.x, l.y, h.z), p(h.x, h.y, h.z), p(l.x, h.y, h.z)]),
    ],
  };
}

/** All face vertices (shared vertices appear several times). */
export const polyhedronVertices = (poly: ConvexPolyhedron): Vec3[] => poly.faces.flatMap((f) => f.winding);

export const polyhedronAabb = (poly: ConvexPolyhedron): Aabb => aabbFromPoints(polyhedronVertices(poly))!;

/** An interior point (vertex average). */
export const polyhedronCenter = (poly: ConvexPolyhedron): Vec3 => average(polyhedronVertices(poly));

/** Volume via the divergence theorem (fan triangles against a reference point). */
export function polyhedronVolume(poly: ConvexPolyhedron): number {
  const r = poly.faces[0]?.winding[0];
  if (!r) return 0;
  let v = 0;
  for (const f of poly.faces) {
    const w = f.winding;
    const a = sub(w[0], r);
    for (let i = 1; i + 1 < w.length; i++) v += dot(a, cross(sub(w[i], r), sub(w[i + 1], r)));
  }
  return v / 6;
}

/**
 * Point-in-polyhedron test. With `strict` the boundary (± eps) counts as
 * outside, otherwise as inside.
 */
export function polyhedronContains(poly: ConvexPolyhedron, p: Vec3, strict = false, eps = PLANE_EPSILON): boolean {
  for (const f of poly.faces) {
    const s = signedDistance(f.plane, p);
    if (strict ? s >= -eps : s > eps) return false;
  }
  return true;
}

/**
 * Clips a convex polyhedron to the front half-space of `plane`.
 *
 * Surviving faces keep their tags; the new cap face lying on `plane` (outward
 * normal = −plane normal) receives `newTag`. If the polyhedron does not span
 * the plane it is returned unchanged (all in front) or null (all behind), so
 * tags of existing faces are never overwritten. Returns null for degenerate
 * results.
 */
export function clipPolyhedron(poly: ConvexPolyhedron, plane: Plane3, newTag: number, eps = PLANE_EPSILON): ConvexPolyhedron | null {
  let anyFront = false, anyBack = false;
  for (const f of poly.faces) {
    for (const v of f.winding) {
      const s = signedDistance(plane, v);
      if (s > eps) anyFront = true;
      else if (s < -eps) anyBack = true;
    }
  }
  if (!anyFront) return null;
  if (!anyBack) return poly;

  const faces: PolyFace[] = [];
  for (const f of poly.faces) {
    const w = clipWinding(f.winding, plane, eps);
    if (w) faces.push(w === f.winding ? f : { plane: f.plane, winding: w, tag: f.tag });
  }

  // Cap: the cutting plane (facing out of the kept part) clipped to the inside of every original face.
  const capPlane = flipPlane(plane);
  const box = polyhedronAabb(poly);
  let cap: Winding | null = baseWindingForPlane(capPlane, aabbCenter(box), aabbDiagonal(box) + 1);
  for (const f of poly.faces) {
    cap = clipWinding(cap, flipPlane(f.plane), eps);
    if (!cap) break;
  }
  if (cap) faces.push({ plane: capPlane, winding: cap, tag: newTag });

  if (faces.length < 4) return null;
  const result: ConvexPolyhedron = { faces };
  return polyhedronVolume(result) < MIN_VOLUME ? null : result;
}

/** Splits a polyhedron by `plane` into front and back parts (either may be null). */
export function splitPolyhedron(poly: ConvexPolyhedron, plane: Plane3, tag: number, eps = PLANE_EPSILON): { front: ConvexPolyhedron | null; back: ConvexPolyhedron | null } {
  return { front: clipPolyhedron(poly, plane, tag, eps), back: clipPolyhedron(poly, flipPlane(plane), tag, eps) };
}

/**
 * The cross-section of a polyhedron with a plane (CCW seen from the plane's
 * front), or null if the plane misses it. Used to draw BSP splitters.
 */
export function polyhedronSection(poly: ConvexPolyhedron, plane: Plane3): Winding | null {
  const box = polyhedronAabb(poly);
  let w: Winding | null = baseWindingForPlane(plane, aabbCenter(box), aabbDiagonal(box) + 1);
  for (const f of poly.faces) {
    w = clipWinding(w, flipPlane(f.plane));
    if (!w) return null;
  }
  return w;
}
