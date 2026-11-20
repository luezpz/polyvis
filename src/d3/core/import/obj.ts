/**
 * Wavefront OBJ import (e.g. from Blender) into raw level geometry.
 *
 * The level-design convention is that face normals point **into the rooms**
 * (into empty space). Blender's default modelling of a closed room has
 * outward normals, so either flip normals in Blender ("Flip" on the room
 * mesh) or pass `flipNormals: true`.
 *
 * Steps (see docs/ALGORITHMS.md, "Porting to 3D"):
 *   1. Parse `v` / `f` records (negative indices and `v/vt/vn` forms
 *      supported; everything else is ignored). Optionally convert Blender's
 *      default OBJ axes (Y up, −Z forward) to the compiler's Z-up frame.
 *   2. Triangulate n-gons (ear clipping, so concave Blender n-gons work).
 *   3. Merge coplanar triangles that share an edge back into convex polygons,
 *      so the BSP sees few large faces instead of many triangles.
 *
 * Naming conventions (Blender material / object names; a trailing `.001` duplicate suffix is ignored):
 *   - material `hint` / `hint_<n>`: hint faces (phase 3d), split bias `n` (default {@link OBJ_HINT_BIAS});
 *     they are ordinary walls that the BSP prefers as splitters.
 *   - object / group (`o` / `g`) or material `door_<name>`: an occluding door (phase 4b). Its faces are
 *     not walls; the door volume is the intersection of its supporting face planes (exact for a convex
 *     mesh, the usual door slab), returned in {@link ObjImportResult.doors}. Faces of one name form one door.
 */

import { type Plane3, type Vec3, type Winding, cross, dot, newellNormal, normalize, planeBasis, sanitizeWinding, sub, KEY_QUANTUM, PLANE_EPSILON } from "../math";

/** Split bias of a `hint` material without a number: far below any split count, so hinted planes go first. */
export const OBJ_HINT_BIAS = -1000;

export interface ObjImportOptions {
  /** Reverse every face (use if the mesh normals point out of the rooms). */
  readonly flipNormals: boolean;
  /** Input is Y-up (Blender's default OBJ export axes); convert to Z-up. */
  readonly yUp: boolean;
  /** Uniform scale applied to all positions. */
  readonly scale: number;
}

export const DEFAULT_OBJ_OPTIONS: ObjImportOptions = Object.freeze({ flipNormals: false, yUp: true, scale: 1 });

/** A door found in an OBJ (`door_<name>`): its volume as outward planes (all door vertices behind each). */
export interface ObjDoor {
  readonly name: string;
  readonly planes: readonly Plane3[];
}

export interface ObjImportResult {
  /** Convex faces, CCW seen from the empty side. */
  readonly faces: Winding[];
  /** Split bias per face (`hint` materials), aligned with `faces`; absent when no face has one. */
  readonly faceSplitBias?: number[];
  /** Door volumes (`door_<name>` objects / materials), in first-appearance order. */
  readonly doors: ObjDoor[];
  readonly triangleCount: number;
  /** Faces dropped as degenerate. */
  readonly skipped: number;
}

/** Imports an OBJ document into convex faces suitable for {@link ImportedMesh}. */
export function importObj(text: string, options: Partial<ObjImportOptions> = {}): ObjImportResult {
  const opts = { ...DEFAULT_OBJ_OPTIONS, ...options };
  const positions: Vec3[] = [];
  const polygons: number[][] = [];
  const polygonBias: number[] = [];
  const doorPolys = new Map<string, number[][]>();
  let material = "", object = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("usemtl ")) material = baseName(line.slice(7));
    else if (line.startsWith("o ") || line.startsWith("g ")) object = baseName(line.slice(2));
    else if (line.startsWith("v ")) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      if (![x, y, z].every(Number.isFinite)) throw new Error(`Bad vertex: ${line}`);
      const s = opts.scale;
      // Y-up → Z-up is the rotation (x, y, z) → (x, −z, y); it preserves winding orientation.
      positions.push(opts.yUp ? { x: x * s, y: -z * s, z: y * s } : { x: x * s, y: y * s, z: z * s });
    } else if (line.startsWith("f ")) {
      const idx = line.slice(2).trim().split(/\s+/).map((tok) => {
        const i = parseInt(tok.split("/")[0], 10);
        if (!Number.isFinite(i) || i === 0) throw new Error(`Bad face index in: ${line}`);
        return i > 0 ? i - 1 : positions.length + i;
      });
      if (idx.some((i) => i < 0 || i >= positions.length)) throw new Error(`Face index out of range in: ${line}`);
      const door = doorName(object) ?? doorName(material);
      if (door !== null) {
        const list = doorPolys.get(door) ?? [];
        if (!doorPolys.has(door)) doorPolys.set(door, list);
        list.push(idx);
        continue;
      }
      polygons.push(opts.flipNormals ? idx.reverse() : idx);
      polygonBias.push(hintBias(material));
    }
  }

  // Weld duplicate positions so shared edges are detected even if the exporter split vertices.
  const weld = new Map<string, number>();
  const remap = positions.map((p, i) => {
    const key = `${Math.round(p.x / KEY_QUANTUM)},${Math.round(p.y / KEY_QUANTUM)},${Math.round(p.z / KEY_QUANTUM)}`;
    const existing = weld.get(key);
    if (existing !== undefined) return existing;
    weld.set(key, i);
    return i;
  });

  let skipped = 0;
  const triangles: number[][] = [];
  const triangleBias: number[] = [];
  polygons.forEach((poly, pi) => {
    const ids = poly.map((i) => remap[i]).filter((v, k, a) => v !== a[(k + 1) % a.length]);
    const tris = triangulate(ids, positions);
    if (tris.length === 0) skipped++;
    for (const t of tris) { triangles.push(t); triangleBias.push(polygonBias[pi]); }
  });

  const merged = mergeCoplanar(triangles, positions, triangleBias);
  const faces: Winding[] = [];
  const bias: number[] = [];
  for (const { loop, bias: b } of merged) {
    const w = sanitizeWinding(loop.map((i) => positions[i]));
    if (w) { faces.push(w); bias.push(b); }
    else skipped++;
  }
  const doors = [...doorPolys].map(([name, polys]) => ({ name, planes: supportingPlanes(polys, positions) }));
  return { faces, ...(bias.some((b) => b !== 0) ? { faceSplitBias: bias } : {}), doors, triangleCount: triangles.length, skipped };
}

/** An OBJ name without Blender's `.001`-style duplicate suffix. */
const baseName = (raw: string): string => raw.trim().replace(/\.\d+$/, "");

/** `name` of `door_<name>`, else null. */
const doorName = (name: string): string | null => (name.startsWith("door_") && name.length > 5 ? name.slice(5) : null);

/** Split bias of a material: `hint` → {@link OBJ_HINT_BIAS}, `hint_<n>` → n (if finite, else the default), else 0. */
function hintBias(material: string): number {
  if (material !== "hint" && !material.startsWith("hint_")) return 0;
  const v = Number(material.slice(5));
  return material.length > 5 && Number.isFinite(v) && v !== 0 ? v : OBJ_HINT_BIAS;
}

/**
 * Door volume of a mesh: the planes of its faces that support it (every vertex of the mesh behind,
 * within `PLANE_EPSILON`), oriented outward whatever the face winding. For a convex mesh that is all
 * of them and the intersection is the mesh; a concave mesh yields a smaller (possibly unbounded) volume.
 */
function supportingPlanes(polys: readonly number[][], pos: readonly Vec3[]): Plane3[] {
  const used = [...new Set(polys.flat())].map((i) => pos[i]);
  const out: Plane3[] = [];
  for (const poly of polys) {
    const raw = newellNormal(poly.map((i) => pos[i]));
    if (raw.x * raw.x + raw.y * raw.y + raw.z * raw.z < 1e-24) continue;
    let n = normalize(raw), d = dot(n, pos[poly[0]]);
    let front = 0, back = 0;
    for (const p of used) {
      const s = dot(n, p) - d;
      if (s > PLANE_EPSILON) front++;
      else if (s < -PLANE_EPSILON) back++;
    }
    if (front > 0 && back > 0) continue; // not a supporting plane (concave part)
    if (front > 0) { n = { x: -n.x, y: -n.y, z: -n.z }; d = -d; }
    out.push({ n, d });
  }
  return out;
}

/** Ear-clipping triangulation of a planar polygon given by vertex indices. */
function triangulate(ids: readonly number[], pos: readonly Vec3[]): number[][] {
  if (ids.length < 3) return [];
  const pts = ids.map((i) => pos[i]);
  const nRaw = newellNormal(pts);
  if (nRaw.x * nRaw.x + nRaw.y * nRaw.y + nRaw.z * nRaw.z < 1e-24) return [];
  if (ids.length === 3) return [[...ids]];
  const { u, v } = planeBasis({ n: normalize(nRaw), d: 0 });
  const p2 = pts.map((p) => ({ x: dot(p, u), y: dot(p, v) }));
  const cross2 = (a: number, b: number, c: number) => (p2[b].x - p2[a].x) * (p2[c].y - p2[a].y) - (p2[b].y - p2[a].y) * (p2[c].x - p2[a].x);
  const inside = (p: number, a: number, b: number, c: number) => cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;

  const rest = ids.map((_, k) => k);
  const out: number[][] = [];
  let guard = rest.length * rest.length;
  while (rest.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < rest.length; k++) {
      const a = rest[(k + rest.length - 1) % rest.length], b = rest[k], c = rest[(k + 1) % rest.length];
      if (cross2(a, b, c) <= 1e-12) continue; // reflex or degenerate corner
      if (rest.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([ids[a], ids[b], ids[c]]);
      rest.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // numerically degenerate polygon: give up on the remainder
  }
  if (rest.length === 3) out.push(rest.map((k) => ids[k]));
  return out;
}

/**
 * Greedily merges coplanar polygons (vertex-index loops) that share an edge,
 * as long as the union stays convex.
 */
function mergeCoplanar(polys: readonly number[][], pos: readonly Vec3[], bias: readonly number[]): { loop: number[]; bias: number }[] {
  const normalOf = (p: readonly number[]) => normalize(newellNormal(p.map((i) => pos[i])));
  // Faces of different split bias never merge (a hint face stays its own face).
  const groups = new Map<string, { normal: Vec3; bias: number; polys: number[][] }>();
  polys.forEach((p, pi) => {
    const n = normalOf(p);
    const d = dot(n, pos[p[0]]);
    const key = `${Math.round(n.x * 1e4)},${Math.round(n.y * 1e4)},${Math.round(n.z * 1e4)},${Math.round(d * 1e3)}|${bias[pi]}`;
    const g = groups.get(key);
    if (g) g.polys.push([...p]);
    else groups.set(key, { normal: n, bias: bias[pi], polys: [[...p]] });
  });

  const out: { loop: number[]; bias: number }[] = [];
  for (const { normal, bias: b, polys: group } of groups.values()) {
    let changed = true;
    while (changed) {
      changed = false;
      const edgeOwner = new Map<string, number>();
      group.forEach((p, pi) => p.forEach((a, k) => edgeOwner.set(`${a},${p[(k + 1) % p.length]}`, pi)));
      for (let pi = 0; pi < group.length && !changed; pi++) {
        const p = group[pi];
        for (let k = 0; k < p.length; k++) {
          const a = p[k], b = p[(k + 1) % p.length];
          const qi = edgeOwner.get(`${b},${a}`);
          if (qi === undefined || qi === pi) continue;
          const merged = joinAtEdge(p, group[qi], a, b);
          if (!merged || !isConvex(merged, pos, normal)) continue;
          group[pi] = merged;
          group.splice(qi, 1);
          changed = true;
          break;
        }
      }
    }
    for (const loop of group) out.push({ loop, bias: b });
  }
  return out;
}

/** Joins loop `p` (containing edge a→b) with loop `q` (containing b→a) into one loop. */
function joinAtEdge(p: readonly number[], q: readonly number[], a: number, b: number): number[] | null {
  const ib = p.indexOf(b);
  const ia = q.indexOf(a);
  if (ib < 0 || ia < 0) return null;
  const pr = [...p.slice(ib), ...p.slice(0, ib)]; // b ... a
  const qr = [...q.slice(ia), ...q.slice(0, ia)]; // a ... b
  const merged = [...pr, ...qr.slice(1, -1)];
  return new Set(merged).size === merged.length ? merged : null;
}

/** Convex (collinear vertices allowed) and CCW around `normal`. */
function isConvex(loop: readonly number[], pos: readonly Vec3[], normal: Vec3): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = pos[loop[i]], b = pos[loop[(i + 1) % n]], c = pos[loop[(i + 2) % n]];
    const e1 = sub(b, a), e2 = sub(c, b);
    const turn = dot(cross(e1, e2), normal);
    if (turn < -1e-9 * Math.max(1, Math.sqrt((e1.x * e1.x + e1.y * e1.y + e1.z * e1.z) * (e2.x * e2.x + e2.y * e2.y + e2.z * e2.z)))) return false;
  }
  return true;
}
