/**
 * Demo levels beyond the basic samples, grouped by what they exercise:
 * - Heavy: many leaves/portals; for timing the compiler and the worker pool.
 * - Worst case: shapes that blow up a specific stage (deep flow chains, slit antipenumbrae,
 *   oblique splits, mutually visible alcoves).
 * - Edge case: degenerate-ish contacts and numerics (hairline gaps, vertex-only touches,
 *   overlapping CSG, many-sided curves, far-from-origin coordinates).
 * Kept out of SAMPLE_LEVELS so the default test suite stays fast; `tests/d2/demos.test.ts`
 * covers the cheap ones.
 */

import { mazeEdges, rng } from "../../../shared/core";
import { type BrushSpec, build, ngon, room, solid } from "./builder";
import { SAMPLE_LEVELS, type SampleLevel } from "./samples";

const HEAVY = "Heavy", WORST = "Worst case", EDGE = "Edge case";

/** `n × n` grid of 6×6 rooms on an 8-unit pitch, every neighbour pair joined by a 2-wide door. */
function gridCity(n: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * 8, y = j * 8;
    specs.push(room(x, y, x + 6, y + 6));
    if (i < n - 1) specs.push(room(x + 6, y + 2, x + 8, y + 4));
    if (j < n - 1) specs.push(room(x + 2, y + 6, x + 4, y + 8));
  }
  return specs;
}

/** Perfect maze: `n × n` cells of 3×3 on a 4-unit pitch, passages 1.5 wide. */
function maze(n: number, seed: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let c = 0; c < n * n; c++) {
    const x = (c % n) * 4, y = Math.floor(c / n) * 4;
    specs.push(room(x, y, x + 3, y + 3));
  }
  for (const [a, b] of mazeEdges(n, n, seed)) {
    const c = Math.min(a, b), x = (c % n) * 4, y = Math.floor(c / n) * 4;
    specs.push(Math.abs(a - b) === 1 ? room(x + 3, y + 0.75, x + 4, y + 2.25) : room(x + 0.75, y + 3, x + 2.25, y + 4));
  }
  return specs;
}

/** Hall `w × h` with 1×1 pillars on a staggered `pitch` grid. */
function pillarForest(w: number, h: number, pitch: number): BrushSpec[] {
  const specs: BrushSpec[] = [room(0, 0, w, h)];
  for (let j = 1, row = 0; j * pitch < h; j++, row++) {
    for (let x = pitch / 2 + (row % 2) * (pitch / 2); x + 1 < w; x += pitch) {
      specs.push(solid(x, j * pitch - 0.5, x + 1, j * pitch + 0.5));
    }
  }
  return specs;
}

/** Back-and-forth corridor of `bands` horizontal runs: a deep, narrow portal chain. */
function serpentine(bands: number, len: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let j = 0; j < bands; j++) {
    specs.push(room(0, j * 4, len, j * 4 + 2));
    if (j < bands - 1) specs.push(j % 2 ? room(0, j * 4 + 2, 2, j * 4 + 4) : room(len - 2, j * 4 + 2, len, j * 4 + 4));
  }
  return specs;
}

/** Long corridor with `teeth` dead-end alcoves on both sides: many small, mutually visible leaves. */
function comb(teeth: number): BrushSpec[] {
  const specs: BrushSpec[] = [room(0, 0, teeth * 3, 2)];
  for (let i = 0; i < teeth; i++) {
    specs.push(room(i * 3 + 1, 2, i * 3 + 2, 8), room(i * 3 + 1, -6, i * 3 + 2, 0));
  }
  return specs;
}

/** Two rooms separated by a 1-thick wall pierced by `slits` thin vertical gaps. */
function slitWall(slits: number, gap: number): BrushSpec[] {
  const specs: BrushSpec[] = [room(0, 0, 20, 20), room(21, 0, 41, 20)];
  for (let i = 0; i < slits; i++) {
    const y = ((i + 0.5) / slits) * 20 - gap / 2;
    specs.push(room(20, y, 21, y + gap));
  }
  return specs;
}

/** Hall with randomly rotated and sized polygonal pillars: oblique BSP planes everywhere. */
function obliqueLattice(n: number, seed: number): BrushSpec[] {
  const rand = rng(seed);
  const specs: BrushSpec[] = [room(0, 0, n * 6, n * 6)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const sides = 3 + Math.floor(rand() * 4);
    specs.push({ kind: "solid", points: ngon(i * 6 + 3, j * 6 + 3, 0.8 + rand() * 1.2, sides, rand() * Math.PI) });
  }
  return specs;
}

export const DEMO_LEVELS: readonly SampleLevel[] = [
  // ---- heavy ----
  { group: HEAVY, name: "Grid city 8×8", description: "64 rooms, each joined to its 4 neighbours: dense portal graph, long sight lines along the streets.", create: () => build(gridCity(8)) },
  { group: HEAVY, name: "Maze 16×16", description: "A perfect maze of 256 cells: many leaves, tiny PVS per leaf.", create: () => build(maze(16, 7)) },
  { group: HEAVY, name: "Pillar forest", description: "A 60×40 hall with ~150 staggered pillars: huge leaf count, everything partly visible.", create: () => build(pillarForest(60, 40, 4)) },
  // ---- worst cases ----
  { group: WORST, name: "Serpentine", description: "A 20-band snake corridor: the deepest possible portal chains for the flow recursion.", create: () => build(serpentine(20, 40)) },
  { group: WORST, name: "Comb", description: "A corridor with 40 alcoves: every alcove sees most of the others through the corridor.", create: () => build(comb(20)) },
  { group: WORST, name: "Slit wall", description: "Two rooms joined only by 15 thin slits: many narrow portals, stress for antipenumbra clipping.", create: () => build(slitWall(15, 0.3)) },
  { group: WORST, name: "Oblique lattice", description: "A hall of randomly rotated polygon pillars: no axis-aligned planes, many sliver cells.", create: () => build(obliqueLattice(7, 3)) },
  // ---- edge cases ----
  {
    group: EDGE, name: "Hairline gap", description: "Top pair shares an edge (one room); bottom pair is split by a 0.01 gap (must not see each other).",
    create: () => build([room(0, 10, 8, 18), room(8, 10, 16, 18), room(0, 0, 8, 8), room(8.01, 0, 16, 8)]),
  },
  {
    group: EDGE, name: "Corner kiss", description: "Rooms touching only at a vertex: zero-width contact, no portal expected.",
    create: () => build([room(0, 0, 8, 8), room(8, 8, 16, 16), room(16, 0, 24, 8)]),
  },
  {
    group: EDGE, name: "Overlap pile", description: "Coincident, nested and overlapping rooms: CSG union must stay watertight.",
    create: () => build([
      room(0, 0, 10, 10), room(0, 0, 10, 10), room(2, 2, 8, 8), room(5, 5, 15, 15), room(10, 0, 20, 5),
      ...Array.from({ length: 6 }, (_, i): BrushSpec => ({ kind: "room", points: ngon(15 + i * 1.5, 12, 4, 6, i * 0.3) })),
    ]),
  },
  {
    group: EDGE, name: "Islands", description: "Disconnected rooms, a room cut in two by a solid, and a pillar floating in a room.",
    create: () => build([room(0, 0, 20, 8), solid(9, 0, 11, 8), room(0, 12, 8, 20), room(12, 12, 20, 20), solid(15, 15, 17, 17)]),
  },
  {
    group: EDGE, name: "Round room", description: "A 64-gon room around a 32-gon pillar: many short edges and nearly parallel planes.",
    create: () => build([{ kind: "room", points: ngon(0, 0, 12, 64) }, { kind: "solid", points: ngon(0, 0, 4, 32) }]),
  },
  {
    group: EDGE, name: "Round room (detail pillar)", description: "Round room with the pillar as a detail brush: drawn, but it neither cuts the BSP nor blocks sight.",
    create: () => build([{ kind: "room", points: ngon(0, 0, 12, 64) }, { kind: "solid", points: ngon(0, 0, 4, 32), detail: true }]),
  },
  {
    group: EDGE, name: "Doors", description: "Three rooms in a row joined by doorways with door brushes (phase 4b); door \"loose\" leaves a gap and is reported as not sealing. Probe with \"Runtime clip: close all doors\".",
    create: () => build([
      room(0, 0, 10, 10), room(10, 4, 14, 6), room(14, 0, 24, 10), room(24, 3, 28, 7), room(28, 0, 38, 10),
      { kind: "solid", box: [11.5, 4, 12.5, 6], door: "west" },
      { kind: "solid", box: [25.5, 3, 26.5, 6], door: "loose" },
    ]),
  },
  {
    group: EDGE, name: "Needle", description: "A 100-long, 0.2-wide corridor into a sliver triangle: extreme aspect ratios.",
    create: () => build([room(-8, -4, 0, 4), room(0, -0.1, 100, 0.1), { kind: "room", points: [{ x: 100, y: -0.3 }, { x: 130, y: 0 }, { x: 100, y: 0.3 }] }]),
  },
  {
    group: EDGE, name: "Far from origin", description: "The Two rooms layout shifted to (4000, -3000): checks tolerances at large coordinates.",
    create: () => build([room(4000, -3000, 4008, -2992), room(4008, -2997, 4010, -2995), room(4010, -3000, 4018, -2992)]),
  },
  { group: EDGE, name: "Single room", description: "One room, no portals: the trivial PVS.", create: () => build([room(0, 0, 10, 6)]) },
];

/** Everything the editor's level picker offers: the basic samples first, then the demos. */
export const ALL_LEVELS: readonly SampleLevel[] = [...SAMPLE_LEVELS, ...DEMO_LEVELS];
