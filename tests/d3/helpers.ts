/** Shared test utilities. */

import {
  type Brush, type BrushKind, type Level, type Vec3, type CompileResult,
  LEVEL_FORMAT, LEVEL_VERSION, makeBoxBrush, locateLeaf, polyhedronContains, polyhedronAabb,
} from "../../src/d3/core";

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BoxSpec = [BrushKind, number, number, number, number, number, number];

export function boxLevel(boxes: BoxSpec[]): Level {
  const brushes: Brush[] = boxes.map(([kind, x0, y0, z0, x1, y1, z1], i) => makeBoxBrush(i + 1, kind, { x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 })!);
  return { format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes, meshes: [] };
}

/**
 * Random grid-aligned level: a chain of overlapping box rooms that wander in
 * x, y and z, plus some solid blocks inside rooms.
 */
export function randomLevel(seed: number, roomCount = 6): Level {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const boxes: BoxSpec[] = [];
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < roomCount; i++) {
    const w = int(2, 8), d = int(2, 8), h = int(2, 5);
    boxes.push(["room", x, y, z, x + w, y + d, z + h]);
    // Next room overlaps or touches this one (always overlapping in the other two axes).
    const axis = r();
    if (axis < 0.45) { x += int(1, w); y += int(-d + 1, d - 1); z += int(-h + 1, h - 1); }
    else if (axis < 0.9) { y += int(1, d); x += int(-w + 1, w - 1); z += int(-h + 1, h - 1); }
    else { z += int(1, h); x += int(-w + 1, w - 1); y += int(-d + 1, d - 1); }
  }
  for (let i = 0; i < roomCount / 2; i++) {
    const [, x0, y0, z0, x1, y1, z1] = boxes[int(0, boxes.length - 1)];
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const sx = int(x0 + 1, x1 - 2), sy = int(y0 + 1, y1 - 2);
    boxes.push(["solid", sx, sy, z0, sx + 1, sy + 1, int(z0 + 1, z1)]);
  }
  return boxLevel(boxes);
}

/** Random point strictly inside a leaf's convex region (rejection sampling in its AABB). */
export function randomPointInLeaf(result: CompileResult, leaf: number, rand: () => number): Vec3 | null {
  const region = result.tree.leaves[leaf].region;
  if (!region) return null;
  const { min, max } = polyhedronAabb(region);
  for (let i = 0; i < 64; i++) {
    const p = { x: min.x + (max.x - min.x) * rand(), y: min.y + (max.y - min.y) * rand(), z: min.z + (max.z - min.z) * rand() };
    if (polyhedronContains(region, p, true, 1e-3) && locateLeaf(result.tree, p) === leaf) return p;
  }
  return null;
}

export function emptyLeaves(result: CompileResult): number[] {
  return result.tree.leaves.flatMap((l, i) => (l.contents === "empty" && l.region ? [i] : []));
}
