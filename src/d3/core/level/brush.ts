/**
 * Convex brushes, Quake `.map` style: a brush is the intersection of the back
 * half-spaces of a set of planes (normals point **out** of the brush).
 *
 * Planes are the source of truth (that is what gets saved); face windings and
 * bounds are derived by clipping each plane's base winding by all the others
 * and cached on the brush. {@link makeBrush} is the only constructor and
 * guarantees a valid, bounded, non-degenerate brush with no redundant planes.
 */

import {
  type Aabb, type Plane3, type Vec3, type Winding,
  aabbFromPoints, aabbCenter, aabbDiagonal, baseWindingForPlane, clipWinding, flipPlane, normalize, dot, sameOrientedPlane, polyhedronVolume,
  MIN_VOLUME, WORLD_EXTENT, ZERO,
} from "../math";

export type BrushKind = "room" | "solid";

export interface BrushFace {
  /** Outward plane. */
  readonly plane: Plane3;
  /** Face polygon, CCW seen from outside the brush. */
  readonly winding: Winding;
}

export interface Brush {
  /** Stable identifier, unique within a level. */
  readonly id: number;
  readonly kind: BrushKind;
  /** Outward planes, one per face (redundant planes removed). */
  readonly planes: readonly Plane3[];
  /** `faces[i]` lies on `planes[i]`. */
  readonly faces: readonly BrushFace[];
  readonly bounds: Aabb;
}

/** A 2D point, used for prism footprints. */
export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Builds a brush from outward planes. Normals need not be unit length.
 * Returns null if the planes enclose no volume or an unbounded region.
 */
export function makeBrush(id: number, kind: BrushKind, planes: readonly Plane3[]): Brush | null {
  const unique: Plane3[] = [];
  for (const raw of planes) {
    const len = Math.hypot(raw.n.x, raw.n.y, raw.n.z);
    if (!(len > 0) || !Number.isFinite(raw.d)) continue;
    const p: Plane3 = { n: normalize(raw.n), d: raw.d / len };
    if (!unique.some((q) => sameOrientedPlane(p, q))) unique.push(p);
  }

  // Pass 1 with huge base windings finds the extent; pass 2 redoes the clipping with
  // base windings sized to the brush, so vertices are exact to ~1e-15 × brush size.
  const rough = brushFaces(unique, ZERO, WORLD_EXTENT);
  if (rough.length < 4) return null;
  const roughBounds = aabbFromPoints(rough.flatMap((f) => f.winding))!;
  const limit = WORLD_EXTENT * 0.5;
  const { min: lo, max: hi } = roughBounds;
  if ([lo.x, lo.y, lo.z, hi.x, hi.y, hi.z].some((c) => Math.abs(c) > limit)) return null;
  const faces = brushFaces(unique, aabbCenter(roughBounds), aabbDiagonal(roughBounds) + 1);
  if (faces.length < 4) return null;
  const keptPlanes = faces.map((f) => f.plane);
  const bounds = aabbFromPoints(faces.flatMap((f) => f.winding))!;
  if (polyhedronVolume({ faces: faces.map((f) => ({ ...f, tag: 0 })) }) < MIN_VOLUME) return null;
  return { id, kind, planes: keptPlanes, faces, bounds };
}

/** Clips each plane's base winding by all other planes; redundant planes (no face) are left out. */
function brushFaces(planes: readonly Plane3[], center: Vec3, halfSize: number): BrushFace[] {
  const faces: BrushFace[] = [];
  for (const p of planes) {
    let w: Winding | null = baseWindingForPlane(p, center, halfSize);
    for (const q of planes) {
      if (q === p) continue;
      w = clipWinding(w, flipPlane(q));
      if (!w) break;
    }
    if (w) faces.push({ plane: p, winding: w });
  }
  return faces;
}

/** Axis-aligned box brush spanning two corners. */
export function makeBoxBrush(id: number, kind: BrushKind, a: Vec3, b: Vec3): Brush | null {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  return makeBrush(id, kind, [
    { n: { x: -1, y: 0, z: 0 }, d: -x0 },
    { n: { x: 1, y: 0, z: 0 }, d: x1 },
    { n: { x: 0, y: -1, z: 0 }, d: -y0 },
    { n: { x: 0, y: 1, z: 0 }, d: y1 },
    { n: { x: 0, y: 0, z: -1 }, d: -z0 },
    { n: { x: 0, y: 0, z: 1 }, d: z1 },
  ]);
}

/**
 * Vertical prism: the convex hull of a 2D footprint (XY plane) extruded from
 * `z0` to `z1`.
 */
export function makePrismBrush(id: number, kind: BrushKind, footprint: readonly Point2[], z0: number, z1: number): Brush | null {
  const hull = convexHull2(footprint);
  if (hull.length < 3) return null;
  const planes: Plane3[] = [
    { n: { x: 0, y: 0, z: -1 }, d: -Math.min(z0, z1) },
    { n: { x: 0, y: 0, z: 1 }, d: Math.max(z0, z1) },
  ];
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    // CCW footprint: the outside is to the right of p→q.
    const n = normalize({ x: q.y - p.y, y: p.x - q.x, z: 0 });
    planes.push({ n, d: n.x * p.x + n.y * p.y });
  }
  return makeBrush(id, kind, planes);
}

/** The brush moved by `delta` (null if `delta` is not finite). */
export function translateBrush(brush: Brush, delta: Vec3): Brush | null {
  return makeBrush(brush.id, brush.kind, brush.planes.map((p) => ({ n: p.n, d: p.d + dot(p.n, delta) })));
}

/** The brush with face `index` pushed outwards by `offset` (pulled in if negative). Null if that degenerates it. */
export function moveBrushFace(brush: Brush, index: number, offset: number): Brush | null {
  return makeBrush(brush.id, brush.kind, brush.planes.map((p, i) => (i === index ? { n: p.n, d: p.d + offset } : p)));
}

/** All vertices of the brush (face corners, shared corners repeated). */
export const brushVertices = (brush: Brush): Vec3[] => brush.faces.flatMap((f) => f.winding);

/** Brush volume. */
export const brushVolume = (brush: Brush): number => polyhedronVolume({ faces: brush.faces.map((f) => ({ ...f, tag: 0 })) });

/** Strict (boundary excluded) or inclusive point-in-brush test. */
export function brushContains(brush: Brush, p: Vec3, strict = true, eps = 1e-5): boolean {
  for (const pl of brush.planes) {
    const s = pl.n.x * p.x + pl.n.y * p.y + pl.n.z * p.z - pl.d;
    if (strict ? s >= -eps : s > eps) return false;
  }
  return true;
}

/** 2D convex hull (Andrew's monotone chain): counter-clockwise, collinear points removed. */
export function convexHull2(points: readonly Point2[]): Point2[] {
  const pts = [...points].map((p) => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point2, a: Point2, b: Point2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (src: readonly Point2[]): Point2[] => {
    const h: Point2[] = [];
    for (const p of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 1e-12) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return chain(pts).concat(chain([...pts].reverse()));
}
