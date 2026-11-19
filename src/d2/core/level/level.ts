/**
 * Level data model: the editable, serializable source of truth.
 *
 * A level is a list of convex *brushes*. Brushes are combined with CSG:
 *
 *   empty space = (union of all `room` brushes) − (union of all `solid` brushes)
 *
 * `room` brushes carve walkable space (rooms, corridors). `solid` brushes put
 * matter back inside rooms (pillars, crates, dividing walls) and act as
 * occluders. Brush order does not matter. Solids flagged `detail` are left out of
 * the BSP (see {@link Brush.detail}).
 */

import {
  type ConvexPolygon, type Vec2, NO_TAG, MIN_AREA,
  aabbFromPoints, clipPolygon, convexHull, expandAabb, lineFromPoints, polygonFromAabb, signedArea,
} from "../math";

export type BrushKind = "room" | "solid";

export interface Brush {
  /** Stable identifier, unique within a level. */
  readonly id: number;
  readonly kind: BrushKind;
  /** Convex, counter-clockwise vertex loop. Use {@link makeBrush} to guarantee this. */
  readonly vertices: readonly Vec2[];
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
   * Splitter bias per edge (phase 3d hint faces), `faceSplitBias[i]` for the edge `vertices[i] → vertices[i+1]`:
   * copied to the edge's walls as `Wall.splitBias` (negative = the BSP prefers that line as a splitter,
   * positive = avoids it, 0 = no vote; units of wall fragments split). Absent = all 0.
   */
  readonly faceSplitBias?: readonly number[];
}

export const LEVEL_FORMAT = "polyvis-level-2d";
export const LEVEL_VERSION = 1;

export interface Level {
  readonly format: typeof LEVEL_FORMAT;
  readonly version: typeof LEVEL_VERSION;
  readonly brushes: readonly Brush[];
}

export const emptyLevel = (): Level => ({ format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes: [] });

/**
 * Creates a brush from arbitrary points by taking their convex hull, which
 * guarantees a convex counter-clockwise loop. Returns null for degenerate input.
 */
export function makeBrush(id: number, kind: BrushKind, points: readonly Vec2[]): Brush | null {
  const hull = convexHull(points.map((p) => ({ x: p.x, y: p.y })));
  if (hull.length < 3 || signedArea(hull) < MIN_AREA) return null;
  return { id, kind, vertices: hull };
}

/** Axis-aligned box brush spanning two corners. */
export function makeBoxBrush(id: number, kind: BrushKind, a: Vec2, b: Vec2): Brush | null {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  return makeBrush(id, kind, [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]);
}

/**
 * The brush with edge `index` (vertices[index] → vertices[index+1]) pushed outwards along its
 * normal by `offset` (pulled in if negative); the 2D analogue of 3D `moveBrushFace`.
 * The brush is treated as an intersection of half-planes, so neighbouring edges keep their
 * direction and edges that become redundant vanish. Null if the result degenerates.
 */
export function moveBrushEdge(brush: Brush, index: number, offset: number): Brush | null {
  const vs = brush.vertices;
  const n = vs.length;
  if (index < 0 || index >= n || !Number.isFinite(offset)) return null;
  const box = aabbFromPoints(vs);
  if (!box) return null;
  // Start from a box large enough to contain the result, then clip by every (inward) edge line.
  const margin = 1000 * (Math.sqrt((box.max.x - box.min.x) ** 2 + (box.max.y - box.min.y) ** 2) + Math.abs(offset) + 1);
  let poly: ConvexPolygon | null = polygonFromAabb(expandAabb(box, margin));
  for (let i = 0; i < n && poly; i++) {
    const a = vs[i], b = vs[(i + 1) % n];
    const line = lineFromPoints(a, b); // normal = left of a→b = interior of a CCW loop
    if (!line) continue;
    poly = clipPolygon(poly, i === index ? { n: line.n, d: line.d - offset } : line, NO_TAG);
  }
  const moved = poly ? makeBrush(brush.id, brush.kind, poly.vertices) : null;
  return moved && withFlags(moved, brush);
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

/** `brush` with `faceSplitBias` set to `bias` (padded / cut to the edge count; omitted when all 0 or not finite). */
export function withSplitBias<B extends { readonly vertices: readonly Vec2[]; readonly faceSplitBias?: readonly number[] }>(brush: B, bias: readonly number[] | undefined): B {
  const { faceSplitBias: _old, ...rest } = brush;
  const values = brush.vertices.map((_, i) => (Number.isFinite(bias?.[i]) ? bias![i] : 0));
  return (values.some((v) => v !== 0) ? { ...rest, faceSplitBias: values } : rest) as B;
}

/** Source of brush flags: a brush, a builder spec or parsed JSON. */
export interface BrushFlags {
  readonly detail?: boolean;
  readonly door?: string;
  /** Per-edge bias; matched to the target's edges by direction if `vertices` is given, else by position. */
  readonly faceSplitBias?: readonly number[];
  readonly vertices?: readonly Vec2[];
}

/** Unit inward normals of a CCW loop's edges (null for degenerate edges). */
const edgeNormals = (vs: readonly Vec2[]): (Vec2 | null)[] => vs.map((a, i) => lineFromPoints(a, vs[(i + 1) % vs.length])?.n ?? null);

/**
 * `faceSplitBias` of `from` re-indexed for the edges of `to`: by equal direction when `from` has vertices
 * (geometry edits keep edge directions but may drop or rotate edges), else by position.
 */
function carriedSplitBias(to: readonly Vec2[], from: BrushFlags): readonly number[] | undefined {
  const src = from.faceSplitBias;
  if (!src || !src.some((v) => v !== 0)) return undefined;
  if (!from.vertices) return src;
  const old = edgeNormals(from.vertices);
  return edgeNormals(to).map((n) => {
    const j = n ? old.findIndex((m) => m !== null && m.x * n.x + m.y * n.y > 1 - 1e-9) : -1;
    return j >= 0 ? src[j] ?? 0 : 0;
  });
}

/** `to` with the detail flag, door name and edge split biases of `from` (keeps flags across geometry edits). */
export const withFlags = <B extends { readonly vertices: readonly Vec2[]; readonly detail?: boolean; readonly door?: string; readonly faceSplitBias?: readonly number[] }>(to: B, from: BrushFlags): B =>
  withSplitBias(withDoor(withDetail(to, from.detail), from.door), carriedSplitBias(to.vertices, from));

/** True if the brush takes part in the BSP: every room, and solids that are neither detail nor doors. */
export const isStructural = (b: { readonly kind: string; readonly detail?: boolean; readonly door?: string }): boolean => b.kind === "room" || (!b.detail && !b.door);

/** True for a solid brush with a door name (a door volume, see `Brush.door`). */
export const isDoor = (b: { readonly kind: string; readonly door?: string }): boolean => b.kind === "solid" && !!b.door;

export const nextBrushId =(level: Level): number => level.brushes.reduce((m, b) => Math.max(m, b.id), 0) + 1;

export const serializeLevel = (level: Level): string => JSON.stringify(level, null, 2);

/** Parses and validates a level JSON document. Throws with a readable message on malformed input. */
export function parseLevel(json: string): Level {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("Level must be a JSON object");
  const obj = raw as Record<string, unknown>;
  if (obj.format !== LEVEL_FORMAT) throw new Error(`Unknown level format: ${String(obj.format)}`);
  if (obj.version !== LEVEL_VERSION) throw new Error(`Unsupported level version: ${String(obj.version)}`);
  if (!Array.isArray(obj.brushes)) throw new Error("Level.brushes must be an array");

  const brushes: Brush[] = [];
  const seen = new Set<number>();
  for (const [i, b] of (obj.brushes as unknown[]).entries()) {
    const rb = b as Record<string, unknown>;
    const kind = rb.kind;
    if (kind !== "room" && kind !== "solid") throw new Error(`Brush ${i}: invalid kind ${String(kind)}`);
    if (!Array.isArray(rb.vertices)) throw new Error(`Brush ${i}: vertices must be an array`);
    const pts = (rb.vertices as unknown[]).map((v, j) => {
      const rv = v as Record<string, unknown>;
      if (typeof rv?.x !== "number" || typeof rv?.y !== "number") throw new Error(`Brush ${i}: vertex ${j} is not {x, y}`);
      return { x: rv.x, y: rv.y };
    });
    let id = typeof rb.id === "number" && Number.isInteger(rb.id) ? rb.id : -1;
    if (id < 0 || seen.has(id)) id = Math.max(0, ...seen) + 1;
    seen.add(id);
    const brush = makeBrush(id, kind, pts);
    const bias = rb.faceSplitBias;
    if (bias !== undefined && !(Array.isArray(bias) && bias.length === pts.length && bias.every((v) => typeof v === "number" && Number.isFinite(v)))) {
      throw new Error(`Brush ${i}: faceSplitBias must be one finite number per edge`);
    }
    if (brush) brushes.push(withFlags(brush, { detail: rb.detail === true, door: typeof rb.door === "string" ? rb.door : undefined, faceSplitBias: bias as number[] | undefined, vertices: pts }));
  }
  return { format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes };
}
