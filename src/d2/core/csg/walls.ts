/**
 * CSG: turns overlapping convex brushes into the boundary "walls" of the
 * empty space.
 *
 *   empty = (∪ room brushes) − (∪ solid brushes)
 *
 * Algorithm (an edge-based variant of the classic Quake `qbsp` CSG step):
 *
 * 1. **Fragment.** Every brush edge is split at every point where another
 *    brush's edge crosses or touches it, and at every other-brush vertex lying
 *    on it. After this, any two collinear overlapping edges have been cut into
 *    identical pieces.
 * 2. **Classify.** For each piece, probe a point a tiny distance to its left
 *    and to its right. If exactly one side is empty space the piece is a wall;
 *    it is oriented so the empty side is on its left (its front).
 *    Pieces internal to the union (both sides empty) or buried in solid (both
 *    sides solid) are discarded — this is what removes the faces where rooms
 *    touch or overlap.
 * 3. **De-duplicate.** Coincident edges from different brushes produce
 *    identical wall pieces; keep one.
 * 4. **Merge.** Collinear, touching, same-facing pieces are welded back
 *    together so the BSP sees long clean walls instead of many fragments.
 *
 * The output boundary is always closed (watertight) because it is the boundary
 * of a union of polygons. Raw, possibly leaky input (e.g. imported meshes) can
 * skip this module and feed walls straight into the BSP compiler.
 */

import {
  type Vec2, type Segment,
  addScaled, distance, distanceSq, lerp, midpoint, normalize, perpLeft, sub, dot,
  segmentIntersection, projectParam, distanceToSegmentLine, convexContains, lineFromPoints,
  KEY_QUANTUM, MIN_LENGTH, MIN_LENGTH_SQ, NORMAL_EPSILON, PLANE_EPSILON, PROBE_OFFSET,
} from "../math";
import { type Bvh, type Wall as SharedWall, bvhAnyAt, bvhQueryBox, buildBvh } from "../../../shared/core";
import type { Dim2 } from "../geometry";
import { type Brush, isStructural } from "../level";

/** A boundary segment of the empty space; empty space is on its left (front). Fields are named as in 3D: `winding` is the segment, `plane` its line. */
export type Wall = SharedWall<Dim2>;

/** Point classifier for the CSG result. */
export type EmptySpaceTest = (p: Vec2) => boolean;

/** Brushes with their bounding boxes in a BVH (broad phase: CSG cost was O(edges × brushes)). */
interface BrushIndex {
  readonly brushes: readonly Brush[];
  /** `[minX, minY, maxX, maxY]` per brush. */
  readonly boxes: Float64Array;
  readonly bvh: Bvh;
}

/** Builds the {@link BrushIndex} of `brushes`. */
function indexBrushes(brushes: readonly Brush[]): BrushIndex {
  const boxes = new Float64Array(brushes.length * 4);
  brushes.forEach((b, i) => {
    const xs = b.vertices.map((v) => v.x), ys = b.vertices.map((v) => v.y);
    boxes.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], i * 4);
  });
  return { brushes, boxes, bvh: buildBvh(boxes, 2) };
}

/** Builds the empty-space membership test for a set of brushes. */
export function makeEmptySpaceTest(brushes: readonly Brush[]): EmptySpaceTest {
  const rooms = indexBrushes(brushes.filter((b) => b.kind === "room"));
  const solids = indexBrushes(brushes.filter((b) => b.kind === "solid"));
  // Strict containment: brush boundaries are never empty on their own; the probes sit off the boundary.
  const inside = (ix: BrushIndex, p: Vec2) => bvhAnyAt(ix.bvh, ix.boxes, [p.x, p.y], 0, (i) => convexContains(ix.brushes[i].vertices, p, true));
  return (p) => inside(rooms, p) && !inside(solids, p);
}

/** Creates a wall from a segment (empty space on the left); `splitBias`: `Wall.splitBias` (0 = omitted). Null for degenerate segments. */
export function makeWall(seg: Segment, sourceId = -1, splitBias = 0): Wall | null {
  const plane = lineFromPoints(seg.a, seg.b);
  if (!plane || distanceSq(seg.a, seg.b) < MIN_LENGTH_SQ) return null;
  return splitBias ? { winding: seg, plane, sourceId, splitBias } : { winding: seg, plane, sourceId };
}

/**
 * Faces of the level's detail brushes, from the CSG of **all** brushes (so they are trimmed where
 * they enter other solids or leave the rooms). Structural walls come from {@link buildWalls} over
 * structural brushes only: dropping detail faces from the full CSG would leave holes (e.g. in the
 * floor under a pillar) and the BSP would leak through them.
 */
export function buildDetailWalls(brushes: readonly Brush[]): Wall[] {
  const detail = new Set(brushes.filter((b) => !isStructural(b)).map((b) => b.id));
  return detail.size ? buildWalls(brushes).filter((w) => detail.has(w.sourceId)) : [];
}

/** Computes the walls of the CSG result of `brushes`. */
export function buildWalls(brushes: readonly Brush[]): Wall[] {
  const isEmpty = makeEmptySpaceTest(brushes);
  const index = indexBrushes(brushes);
  const pieces: Wall[] = [];

  for (const brush of brushes) {
    const n = brush.vertices.length;
    for (let i = 0; i < n; i++) {
      const edge: Segment = { a: brush.vertices[i], b: brush.vertices[(i + 1) % n] };
      // Only brushes whose box reaches the edge can cut it (hits lie on it; on-line vertices within PLANE_EPSILON).
      const near = bvhQueryBox(index.bvh, index.boxes, [Math.min(edge.a.x, edge.b.x), Math.min(edge.a.y, edge.b.y)], [Math.max(edge.a.x, edge.b.x), Math.max(edge.a.y, edge.b.y)], 2 * PLANE_EPSILON);
      for (const piece of fragmentEdge(edge, brush, near.map((j) => brushes[j]))) {
        const wall = classifyPiece(piece, brush.id, isEmpty, brush.faceSplitBias?.[i] ?? 0);
        if (wall) pieces.push(wall);
      }
    }
  }
  return mergeCollinear(dedupe(pieces));
}

/** Splits an edge at all intersections with other brushes' edges and vertices (`brushes`: candidates, may include `owner`). */
function fragmentEdge(edge: Segment, owner: Brush, brushes: readonly Brush[]): Segment[] {
  const params: number[] = [0, 1];
  const len = distance(edge.a, edge.b);
  const paramEps = MIN_LENGTH / Math.max(len, MIN_LENGTH);

  for (const other of brushes) {
    if (other === owner) continue;
    const m = other.vertices.length;
    for (let j = 0; j < m; j++) {
      const p = other.vertices[j];
      const q = other.vertices[(j + 1) % m];
      const hit = segmentIntersection(edge.a, edge.b, p, q);
      if (hit) params.push(hit.t);
      // Vertices lying on the edge (covers collinear overlaps, which `segmentIntersection` ignores).
      if (distanceToSegmentLine(edge, p) < PLANE_EPSILON) params.push(projectParam(edge, p));
    }
  }

  params.sort((x, y) => x - y);
  const cuts: number[] = [];
  for (const t of params) {
    if (t < 0 || t > 1) continue;
    if (cuts.length === 0 || t - cuts[cuts.length - 1] > paramEps) cuts.push(t);
  }
  // Make sure the final cut is exactly 1 (it may have been merged with a nearby parameter).
  cuts[cuts.length - 1] = 1;

  const out: Segment[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    out.push({ a: k === 0 ? edge.a : lerp(edge.a, edge.b, cuts[k]), b: k + 2 === cuts.length ? edge.b : lerp(edge.a, edge.b, cuts[k + 1]) });
  }
  return out;
}

/** Decides whether a piece separates empty from non-empty space, and orients it. */
function classifyPiece(piece: Segment, brushId: number, isEmpty: EmptySpaceTest, splitBias: number): Wall | null {
  if (distanceSq(piece.a, piece.b) < MIN_LENGTH_SQ) return null;
  const m = midpoint(piece.a, piece.b);
  const left = normalize(perpLeft(sub(piece.b, piece.a)));
  const emptyLeft = isEmpty(addScaled(m, left, PROBE_OFFSET));
  const emptyRight = isEmpty(addScaled(m, left, -PROBE_OFFSET));
  if (emptyLeft === emptyRight) return null;
  return makeWall(emptyLeft ? piece : { a: piece.b, b: piece.a }, brushId, splitBias);
}

const quant = (v: number): number => Math.round(v / KEY_QUANTUM);
const pointKey = (p: Vec2): string => `${quant(p.x)},${quant(p.y)}`;

/** Lower of two split biases, 0 meaning "no vote" (see `Wall.splitBias`). */
const minBias = (a: number, b: number): number => (a === 0 ? b : b === 0 ? a : Math.min(a, b));

/** Drops identical walls; the kept one takes the lowest split bias of its duplicates (a vote survives dedupe). */
function dedupe(walls: readonly Wall[]): Wall[] {
  const kept = new Map<string, Wall>();
  for (const w of walls) {
    const key = `${pointKey(w.winding.a)}>${pointKey(w.winding.b)}`;
    const old = kept.get(key);
    if (!old) kept.set(key, w);
    else {
      const bias = minBias(old.splitBias ?? 0, w.splitBias ?? 0);
      if (bias !== (old.splitBias ?? 0)) kept.set(key, { ...old, splitBias: bias });
    }
  }
  return [...kept.values()];
}

/** Welds chains of collinear, same-direction walls that touch end-to-start. */
function mergeCollinear(walls: readonly Wall[]): Wall[] {
  const byStart = new Map<string, number[]>();
  const byEnd = new Map<string, number[]>();
  walls.forEach((w, i) => {
    push(byStart, pointKey(w.winding.a), i);
    push(byEnd, pointKey(w.winding.b), i);
  });
  const used = new Uint8Array(walls.length);
  const collinear = (i: number, j: number) => dot(walls[i].plane.n, walls[j].plane.n) > 1 - NORMAL_EPSILON;

  const out: Wall[] = [];
  for (let i = 0; i < walls.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let a = walls[i].winding.a;
    let b = walls[i].winding.b;
    let bias = walls[i].splitBias ?? 0;
    // Extend forward.
    for (let cur = i; ;) {
      const next = (byStart.get(pointKey(b)) ?? []).find((j) => !used[j] && collinear(cur, j));
      if (next === undefined) break;
      used[next] = 1;
      b = walls[next].winding.b;
      bias = minBias(bias, walls[next].splitBias ?? 0);
      cur = next;
    }
    // Extend backward.
    for (let cur = i; ;) {
      const prev = (byEnd.get(pointKey(a)) ?? []).find((j) => !used[j] && collinear(cur, j));
      if (prev === undefined) break;
      used[prev] = 1;
      a = walls[prev].winding.a;
      bias = minBias(bias, walls[prev].splitBias ?? 0);
      cur = prev;
    }
    const merged = makeWall({ a, b }, walls[i].sourceId, bias);
    if (merged) out.push(merged);
  }
  return out;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
