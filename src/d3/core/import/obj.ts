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
 *   - group, object (`g` / `o`, tracked separately) or material `door_<name>`: an occluding door (phase 4b). Its faces are
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
  let material = "", object = "", group = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // Keyword and arguments are separated by any whitespace (spaces or tabs); a bare `o` / `g` clears the name.
    const sp = line.search(/\s/);
    const key = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? "" : line.slice(sp + 1).trim();
    if (key === "usemtl") material = baseName(rest);
    else if (key === "o") { object = baseName(rest); group = ""; }
    else if (key === "g") group = baseName(rest);
    else if (key === "v") {
      const [x, y, z] = rest.split(/\s+/).map(Number);
      if (![x, y, z].every(Number.isFinite)) throw new Error(`Bad vertex: ${line}`);
      const s = opts.scale;
      // Y-up → Z-up is the rotation (x, y, z) → (x, −z, y); it preserves winding orientation.
      positions.push(opts.yUp ? { x: x * s, y: -z * s, z: y * s } : { x: x * s, y: y * s, z: z * s });
    } else if (key === "f") {
      const idx = rest.split(/\s+/).map((tok) => {
        const i = parseInt(tok.split("/")[0], 10);
        if (!Number.isFinite(i) || i === 0) throw new Error(`Bad face index in: ${line}`);
        return i > 0 ? i - 1 : positions.length + i;
      });
      if (idx.some((i) => i < 0 || i >= positions.length)) throw new Error(`Face index out of range in: ${line}`);
      const door = doorName(group) ?? doorName(object) ?? doorName(material);
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
    const { tris, complete } = triangulate(ids, positions);
    if (!complete) skipped++;
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
  // Welded like the walls, so a door's planes come from the same vertices as the faces around it.
  const doors = [...doorPolys].map(([name, polys]) => ({ name, planes: supportingPlanes(polys.map((p) => p.map((i) => remap[i])), positions) }));
  return { faces, ...(bias.some((b) => b !== 0) ? { faceSplitBias: bias } : {}), doors, triangleCount: triangles.length, skipped };
}

/** An OBJ name without Blender's `.001`-style duplicate suffix. */
const baseName = (raw: string): string => raw.trim().replace(/\.\d+$/, "");

/** `name` of `door_<name>`, else null. */
const doorName = (name: string): string | null => (name.startsWith("door_") && name.length > 5 ? name.slice(5) : null);

/** Split bias of a material: `hint` → {@link OBJ_HINT_BIAS}, `hint_<n>` → n (any finite number, so `hint_0` → 0; else the default), else 0. */
function hintBias(material: string): number {
  if (material !== "hint" && !material.startsWith("hint_")) return 0;
  const tail = material.slice(5);
  const v = Number(tail);
  return tail.trim() !== "" && Number.isFinite(v) ? v : OBJ_HINT_BIAS;
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

/**
 * Ear-clipping triangulation of a planar polygon given by vertex indices.
 * `complete`: false if (part of) the polygon was dropped as degenerate.
 */
function triangulate(ids: readonly number[], pos: readonly Vec3[]): { tris: number[][]; complete: boolean } {
  if (ids.length < 3) return { tris: [], complete: false };
  const pts = ids.map((i) => pos[i]);
  const nRaw = newellNormal(pts);
  if (nRaw.x * nRaw.x + nRaw.y * nRaw.y + nRaw.z * nRaw.z < 1e-24) return { tris: [], complete: false };
  if (ids.length === 3) return { tris: [[...ids]], complete: true };
  const { u, v } = planeBasis({ n: normalize(nRaw), d: 0 });
  const p2 = pts.map((p) => ({ x: dot(p, u), y: dot(p, v) }));
  const cross2 = (a: number, b: number, c: number) => (p2[b].x - p2[a].x) * (p2[c].y - p2[a].y) - (p2[b].y - p2[a].y) * (p2[c].x - p2[a].x);
  // Corner tolerance relative to the polygon's size (|nRaw| = twice its area), so scale does not matter.
  const cornerEps = 1e-12 * Math.sqrt(nRaw.x * nRaw.x + nRaw.y * nRaw.y + nRaw.z * nRaw.z);
  const inside = (p: number, a: number, b: number, c: number) => cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;

  const rest = ids.map((_, k) => k);
  const out: number[][] = [];
  let guard = rest.length * rest.length;
  while (rest.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < rest.length; k++) {
      const a = rest[(k + rest.length - 1) % rest.length], b = rest[k], c = rest[(k + 1) % rest.length];
      if (cross2(a, b, c) <= cornerEps) continue; // reflex or degenerate corner
      // Compare vertex ids, not loop slots: a polygon touching itself repeats a vertex, which must not block its own ear.
      const ia = ids[a], ib = ids[b], ic = ids[c];
      if (rest.some((p) => ids[p] !== ia && ids[p] !== ib && ids[p] !== ic && inside(p, a, b, c))) continue;
      out.push([ids[a], ids[b], ids[c]]);
      rest.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // numerically degenerate polygon: give up on the remainder
  }
  if (rest.length === 3) out.push(rest.map((k) => ids[k]));
  // A leftover of zero area (e.g. the doubled-back spokes of a self-touching loop) loses nothing.
  const left = rest.length === 3 ? null : newellNormal(rest.map((k) => pts[k]));
  const complete = !left || left.x * left.x + left.y * left.y + left.z * left.z < 1e-24 * (nRaw.x * nRaw.x + nRaw.y * nRaw.y + nRaw.z * nRaw.z + 1);
  return { tris: out, complete };
}

/**
 * Greedily merges coplanar polygons (vertex-index loops) that share an edge,
 * as long as the union stays convex and planar.
 */
function mergeCoplanar(polys: readonly number[][], pos: readonly Vec3[], bias: readonly number[]): { loop: number[]; bias: number }[] {
  const normalOf = (p: readonly number[]) => normalize(newellNormal(p.map((i) => pos[i])));
  // Faces of different split bias never merge (a hint face stays its own face).
  const groups = new Map<string, Group>();
  const all: Group[] = [];
  polys.forEach((p, pi) => {
    const n = normalOf(p);
    const d = dot(n, pos[p[0]]);
    const g = findGroup(groups, n, d, bias[pi]);
    if (g) g.polys.push([...p]);
    else {
      const ng: Group = { normal: n, d, bias: bias[pi], polys: [[...p]] };
      groups.set(groupKey(bucketOf(n, d), bias[pi]), ng);
      all.push(ng);
    }
  });
  const out: { loop: number[]; bias: number }[] = [];
  for (const { normal, bias: b, polys: group } of all) {
    for (const loop of mergeGroup(group, pos, normal)) out.push({ loop, bias: b });
  }
  return out;
}

/** A coplanar group of `mergeCoplanar`: its first face's plane (`normal`, `d`) and split bias. */
interface Group {
  readonly normal: Vec3;
  readonly d: number;
  readonly bias: number;
  readonly polys: number[][];
}

/** Bucket scales of a plane (normal, d) in `mergeCoplanar`; faces closer than one bucket are candidates. */
const NORMAL_BUCKET = 1e4, D_BUCKET = 1e3;

/** Scaled plane coordinates (nx, ny, nz, d) whose rounding is the bucket. */
const bucketOf = (n: Vec3, d: number): number[] => [n.x * NORMAL_BUCKET, n.y * NORMAL_BUCKET, n.z * NORMAL_BUCKET, d * D_BUCKET];

const groupKey = (cell: readonly number[], bias: number): string => `${cell.map(Math.round).join(",")}|${bias}`;

/**
 * The group of plane (n, d) with split bias `bias`, or undefined. Looks in the plane's bucket and the
 * 15 neighbours on the near side of each rounding boundary, so near-identical planes straddling a
 * boundary still share a group (rounding alone would split them). Merges re-check planarity exactly.
 */
function findGroup(groups: ReadonlyMap<string, Group>, n: Vec3, d: number, bias: number): Group | undefined {
  const c = bucketOf(n, d);
  const base = c.map(Math.round);
  const step = c.map((x, k) => (x >= base[k] ? 1 : -1));
  for (let mask = 0; mask < 16; mask++) {
    const g = groups.get(groupKey(base.map((b, k) => (mask & (1 << k) ? b + step[k] : b)), bias));
    if (g && Math.abs(g.d - d) * D_BUCKET <= 1 && dot(g.normal, n) >= 1 - 1 / (NORMAL_BUCKET * NORMAL_BUCKET)) return g;
  }
  return undefined;
}

/**
 * Merges one coplanar group on a half-edge structure, so each merge costs O(1) (amortized):
 *
 * - half-edge h runs `from[h] → to[h]` with `next[h]` / `prev[h]` around its loop; `byKey` maps the
 *   directed edge (a·nv + b) to its half-edge, so the twin of a→b is the half-edge of b→a;
 * - merging the loops on both sides of h relinks four pointers and kills h and its twin;
 * - loop identity is a union-find over the input polygons (`root`);
 * - planarity: each loop keeps the interval [lo, hi] of its vertices' signed distances to the group's
 *   plane (normal, d0); a merge is allowed only while hi − lo stays within `PLANE_EPSILON` (the rounded
 *   group key can mix near-coplanar faces, and merging those would make a non-planar face).
 *
 * Both input loops are convex, so their union is convex iff its two new corners (at the ends of h) are.
 * A merge changes only the corners at those two vertices, so only the four half-edges next to them are
 * re-queued: every other half-edge's test is unchanged.
 */
function mergeGroup(group: readonly number[][], pos: readonly Vec3[], normal: Vec3): number[][] {
  const nv = pos.length;
  const from: number[] = [], to: number[] = [], next: number[] = [], prev: number[] = [], owner: number[] = [];
  const parent: number[] = [], lo: number[] = [], hi: number[] = [];
  const d0 = dot(normal, pos[group[0][0]]);
  const byKey = new Map<number, number>();
  // Directed edges used by more than one face (non-manifold or flipped faces): their twin is ambiguous, so never merge across them.
  const shared = new Set<number>();
  group.forEach((p, li) => {
    parent.push(li);
    let l = Infinity, h = -Infinity;
    const base = from.length;
    p.forEach((v, k) => {
      const s = dot(normal, pos[v]) - d0;
      if (s < l) l = s;
      if (s > h) h = s;
      const e = base + k, w = p[(k + 1) % p.length];
      from.push(v); to.push(w); owner.push(li);
      next.push(base + (k + 1) % p.length); prev.push(base + (k + p.length - 1) % p.length);
      if (byKey.has(v * nv + w)) shared.add(v * nv + w);
      byKey.set(v * nv + w, e);
    });
    lo.push(l); hi.push(h);
  });
  const dead = new Uint8Array(from.length);
  const root = (li: number): number => {
    while (parent[li] !== li) li = parent[li] = parent[parent[li]];
    return li;
  };

  const queue = from.map((_, e) => e);
  while (queue.length) {
    const h = queue.pop()!;
    if (dead[h]) continue;
    if (shared.has(from[h] * nv + to[h]) || shared.has(to[h] * nv + from[h])) continue;
    const t = byKey.get(to[h] * nv + from[h]);
    if (t === undefined || dead[t]) continue;
    const rp = root(owner[h]), rq = root(owner[t]);
    if (rp === rq) continue;
    const a = from[h], e = to[h];
    // New corners: pPrev → a → qNext and qPrev → e → pNext.
    if (!convexTurn(pos[from[prev[h]]], pos[a], pos[to[next[t]]], normal) || !convexTurn(pos[from[prev[t]]], pos[e], pos[to[next[h]]], normal)) continue;
    const l = Math.min(lo[rp], lo[rq]), u = Math.max(hi[rp], hi[rq]);
    if (u - l > PLANE_EPSILON) continue;
    const hp = prev[h], hn = next[h], tp = prev[t], tn = next[t];
    next[hp] = tn; prev[tn] = hp;
    next[tp] = hn; prev[hn] = tp;
    dead[h] = dead[t] = 1;
    byKey.delete(a * nv + e);
    byKey.delete(e * nv + a);
    parent[rq] = rp;
    lo[rp] = l; hi[rp] = u;
    queue.push(hp, hn, tp, tn);
  }

  // Walk each surviving loop once.
  const out: number[][] = [];
  const seen = new Uint8Array(from.length);
  for (let s = 0; s < from.length; s++) {
    if (dead[s] || seen[s]) continue;
    const loop: number[] = [];
    for (let e = s; !seen[e]; e = next[e]) {
      seen[e] = 1;
      loop.push(from[e]);
    }
    out.push(loop);
  }
  return out;
}

/**
 * True if the corner a→b→c turns left or goes straight on around `normal` (length-relative tolerance).
 * A 180° reversal (c doubling back along a→b) is not convex: it means the loops share more than one edge.
 */
function convexTurn(a: Vec3, b: Vec3, c: Vec3, normal: Vec3): boolean {
  const e1 = sub(b, a), e2 = sub(c, b);
  const turn = dot(cross(e1, e2), normal);
  const tol = 1e-9 * Math.max(1, Math.sqrt((e1.x * e1.x + e1.y * e1.y + e1.z * e1.z) * (e2.x * e2.x + e2.y * e2.y + e2.z * e2.z)));
  if (turn < -tol) return false;
  return turn > tol || dot(e1, e2) > 0;
}
