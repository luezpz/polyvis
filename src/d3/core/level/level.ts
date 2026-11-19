/**
 * Level data model: the editable, serializable source of truth.
 *
 * A level is a list of convex *brushes* combined with CSG:
 *
 *   empty space = (union of all `room` brushes) − (union of all `solid` brushes)
 *
 * `room` brushes carve walkable space (rooms, corridors, shafts). `solid`
 * brushes put matter back inside rooms (pillars, floors between storeys,
 * crates) and act as occluders. Brush order does not matter. Solids flagged
 * `detail` are left out of the BSP (see {@link Brush.detail}).
 *
 * A level may additionally hold imported *meshes* (e.g. from Blender): raw
 * polygons with empty space in front, fed to the BSP without CSG. Meshes need
 * not be watertight — leaks are reported, not fatal.
 */

import { type Plane3, type Vec3, type Winding, windingPlane, sanitizeWinding } from "../math";
import { type Brush, type BrushKind, makeBrush, withFlags } from "./brush";

export const LEVEL_FORMAT = "polyvis-level-3d";
export const LEVEL_VERSION = 1;

export interface ImportedMesh {
  /** Stable identifier, unique among the level's meshes. */
  readonly id: number;
  readonly name: string;
  /** Convex planar polygons, CCW seen from the empty side (front). */
  readonly faces: readonly Winding[];
}

export interface Level {
  readonly format: typeof LEVEL_FORMAT;
  readonly version: typeof LEVEL_VERSION;
  readonly brushes: readonly Brush[];
  readonly meshes: readonly ImportedMesh[];
}

export const emptyLevel = (): Level => ({ format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes: [], meshes: [] });

export const nextBrushId = (level: Level): number => level.brushes.reduce((m, b) => Math.max(m, b.id), 0) + 1;
export const nextMeshId = (level: Level): number => level.meshes.reduce((m, b) => Math.max(m, b.id), 0) + 1;

type P3 = [number, number, number];
const round = (x: number): number => Math.round(x * 1e9) / 1e9;
const p3 = (v: Vec3): P3 => [round(v.x), round(v.y), round(v.z)];

/**
 * JSON encoding. Brushes are saved as their outward planes
 * `[nx, ny, nz, d]` (inside: `nx*x + ny*y + nz*z <= d` for every plane);
 * derived faces are not stored.
 */
export function serializeLevel(level: Level): string {
  return JSON.stringify({
    format: level.format,
    version: level.version,
    brushes: level.brushes.map((b) => ({ id: b.id, kind: b.kind, ...(b.detail ? { detail: true } : {}), ...(b.door ? { door: b.door } : {}), planes: b.planes.map((p) => [p.n.x, p.n.y, p.n.z, p.d]) })), // full precision: rounding planes moves vertices
    meshes: level.meshes.map((m) => ({ id: m.id, name: m.name, faces: m.faces.map((f) => f.map(p3)) })),
  }, null, 1);
}

/** Parses and validates a level JSON document. Throws with a readable message on malformed input. */
export function parseLevel(json: string): Level {
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== "object" || raw === null) throw new Error("Level must be a JSON object");
  const obj = raw as Record<string, unknown>;
  if (obj.format !== LEVEL_FORMAT) throw new Error(`Unknown level format: ${String(obj.format)} (expected ${LEVEL_FORMAT})`);
  if (obj.version !== LEVEL_VERSION) throw new Error(`Unsupported level version: ${String(obj.version)}`);
  if (!Array.isArray(obj.brushes)) throw new Error("Level.brushes must be an array");

  const brushes: Brush[] = [];
  const seen = new Set<number>();
  for (const [i, b] of (obj.brushes as unknown[]).entries()) {
    const rb = b as Record<string, unknown>;
    const kind = rb.kind as BrushKind;
    if (kind !== "room" && kind !== "solid") throw new Error(`Brush ${i}: invalid kind ${String(kind)}`);
    if (!Array.isArray(rb.planes)) throw new Error(`Brush ${i}: planes must be an array`);
    const planes: Plane3[] = (rb.planes as unknown[]).map((p, j) => {
      if (!Array.isArray(p) || p.length !== 4 || !p.every((c) => typeof c === "number" && Number.isFinite(c))) {
        throw new Error(`Brush ${i}: plane ${j} must be [nx, ny, nz, d]`);
      }
      return { n: { x: p[0], y: p[1], z: p[2] }, d: p[3] };
    });
    let id = typeof rb.id === "number" && Number.isInteger(rb.id) ? rb.id : -1;
    if (id < 0 || seen.has(id)) id = Math.max(0, ...seen) + 1;
    seen.add(id);
    const brush = makeBrush(id, kind, planes);
    if (brush) brushes.push(withFlags(brush, { detail: rb.detail === true, door: typeof rb.door === "string" ? rb.door : undefined }));
  }

  const meshes: ImportedMesh[] = [];
  if (obj.meshes !== undefined) {
    if (!Array.isArray(obj.meshes)) throw new Error("Level.meshes must be an array");
    for (const [i, m] of (obj.meshes as unknown[]).entries()) {
      const rm = m as Record<string, unknown>;
      if (!Array.isArray(rm.faces)) throw new Error(`Mesh ${i}: faces must be an array`);
      const faces: Winding[] = [];
      for (const f of rm.faces as unknown[]) {
        if (!Array.isArray(f)) throw new Error(`Mesh ${i}: each face must be an array of [x, y, z]`);
        const pts = (f as unknown[]).map((v) => {
          if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => typeof c === "number")) throw new Error(`Mesh ${i}: vertex must be [x, y, z]`);
          return { x: v[0], y: v[1], z: v[2] };
        });
        const w = sanitizeWinding(pts);
        if (w && windingPlane(w)) faces.push(w);
      }
      meshes.push({ id: typeof rm.id === "number" ? rm.id : i + 1, name: typeof rm.name === "string" ? rm.name : `mesh ${i + 1}`, faces });
    }
  }
  return { format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes, meshes };
}
