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
  /**
   * Detail brush (solid only; ignored on rooms): kept out of the CSG that feeds the BSP, so its
   * faces never split leaves and it never blocks visibility (Quake "detail" brushes). The PVS
   * stays conservative: dropping an occluder can only make more leaves visible. Absent = structural.
   */
  readonly detail?: boolean;
  /**
   * Door name (solid only; phase 4b occluding doors): like detail, the brush is left out of the BSP
   * (the PVS is baked with the door open), and the portals inside its volume are closed at runtime
   * while the door named so is shut. Brushes sharing a name form one door. Absent = not a door.
   */
  readonly door?: string;
  /**
   * Splitter bias per face (phase 3d hint faces), `faceSplitBias[i]` for `faces[i]` / `planes[i]`: copied
   * to the face's walls as `Wall.splitBias` (negative = the BSP prefers that plane as a splitter,
   * positive = avoids it, 0 = no vote; units of wall fragments split). Absent = all 0.
   */
  readonly faceSplitBias?: readonly number[];
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
    const len = Math.sqrt(raw.n.x * raw.n.x + raw.n.y * raw.n.y + raw.n.z * raw.n.z);
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

/** `brush` with its detail flag set to `detail` (the field is omitted when false, so structural brushes stay unchanged). */
export function withDetail<B extends { readonly detail?: boolean }>(brush: B, detail: boolean | undefined): B {
  const { detail: _old, ...rest } = brush;
  return (detail ? { ...rest, detail: true } : rest) as B;
}

/** `brush` with its door name set to `door` (omitted when empty). */
export function withDoor<B extends { readonly door?: string }>(brush: B, door: string | undefined): B {
  const { door: _old, ...rest } = brush;
  return (door ? { ...rest, door } : rest) as B;
}

/** `brush` with `faceSplitBias` set to `bias` (padded / cut to the face count; omitted when all 0 or not finite). */
export function withSplitBias<B extends { readonly planes: readonly Plane3[]; readonly faceSplitBias?: readonly number[] }>(brush: B, bias: readonly number[] | undefined): B {
  const { faceSplitBias: _old, ...rest } = brush;
  const values = brush.planes.map((_, i) => (Number.isFinite(bias?.[i]) ? bias![i] : 0));
  return (values.some((v) => v !== 0) ? { ...rest, faceSplitBias: values } : rest) as B;
}

/** Source of brush flags: a brush, a builder spec or parsed JSON. */
export interface BrushFlags {
  readonly detail?: boolean;
  readonly door?: string;
  /** Per-face bias; matched to the target's faces by normal if `planes` is given, else by position. */
  readonly faceSplitBias?: readonly number[];
  readonly planes?: readonly Plane3[];
}

/**
 * `faceSplitBias` of `from` re-indexed for the planes `to`: by equal normal direction when `from` has
 * planes (geometry edits keep normals but may drop or reorder faces), else by position.
 */
function carriedSplitBias(to: readonly Plane3[], from: BrushFlags): readonly number[] | undefined {
  const src = from.faceSplitBias;
  if (!src || !src.some((v) => v !== 0)) return undefined;
  const old = from.planes;
  if (!old) return src;
  const unit = old.map((p) => normalize(p.n));
  return to.map((p) => {
    const j = unit.findIndex((n) => dot(n, p.n) > 1 - 1e-9);
    return j >= 0 ? src[j] ?? 0 : 0;
  });
}

/** `to` with the detail flag, door name and face split biases of `from` (keeps flags across geometry edits). */
export const withFlags = <B extends { readonly planes: readonly Plane3[]; readonly detail?: boolean; readonly door?: string; readonly faceSplitBias?: readonly number[] }>(to: B, from: BrushFlags): B =>
  withSplitBias(withDoor(withDetail(to, from.detail), from.door), carriedSplitBias(to.planes, from));

/** True if the brush takes part in the BSP: every room, and solids that are neither detail nor doors. */
export const isStructural = (b: { readonly kind: string; readonly detail?: boolean; readonly door?: string }): boolean => b.kind === "room" || (!b.detail && !b.door);

/** True for a solid brush with a door name (a door volume, see `Brush.door`). */
export const isDoor = (b: { readonly kind: string; readonly door?: string }): boolean => b.kind === "solid" && !!b.door;

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
  const moved = makeBrush(brush.id, brush.kind, brush.planes.map((p) => ({ n: p.n, d: p.d + dot(p.n, delta) })));
  return moved && withFlags(moved, brush);
}

/** The brush with face `index` pushed outwards by `offset` (pulled in if negative). Null if that degenerates it. */
export function moveBrushFace(brush: Brush, index: number, offset: number): Brush | null {
  const moved = makeBrush(brush.id, brush.kind, brush.planes.map((p, i) => (i === index ? { n: p.n, d: p.d + offset } : p)));
  return moved && withFlags(moved, brush);
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
