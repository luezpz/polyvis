/**
 * Demo levels beyond the basic samples, grouped by what they exercise (3D twins of
 * `d2/core/level/demos.ts`, plus vertical cases):
 * - Heavy: many leaves/portals; for timing the compiler and the worker pool.
 * - Worst case: deep flow chains, slit antipenumbrae, oblique splits, mutually visible alcoves.
 * - Edge case: hairline gaps, edge/vertex-only contacts, overlapping CSG, many-sided curves,
 *   far-from-origin coordinates.
 * Kept out of SAMPLE_LEVELS so the default test suite stays fast; `tests/d3/demos.test.ts`
 * covers the cheap ones. Z is up.
 */

import { mazeEdges, rng } from "../../../shared/core";
import { type BrushSpec, build, ngon, ramp, room, solid } from "./builder";
import { SAMPLE_LEVELS, type SampleLevel } from "./samples";

const HEAVY = "Heavy", WORST = "Worst case", EDGE = "Edge case";

/** `n × n` grid of 6×6×4 rooms on an 8-unit pitch, neighbours joined by 2×2.5 doors. */
function gridCity(n: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = i * 8, y = j * 8;
    specs.push(room(x, y, 0, x + 6, y + 6, 4));
    if (i < n - 1) specs.push(room(x + 6, y + 2, 0, x + 8, y + 4, 2.5));
    if (j < n - 1) specs.push(room(x + 2, y + 6, 0, x + 4, y + 8, 2.5));
  }
  return specs;
}

/** Perfect maze: `n × n` cells of 3×3×3 on a 4-unit pitch, passages 1.5 wide and 2.5 high. */
function maze(n: number, seed: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let c = 0; c < n * n; c++) {
    const x = (c % n) * 4, y = Math.floor(c / n) * 4;
    specs.push(room(x, y, 0, x + 3, y + 3, 3));
  }
  for (const [a, b] of mazeEdges(n, n, seed)) {
    const c = Math.min(a, b), x = (c % n) * 4, y = Math.floor(c / n) * 4;
    specs.push(Math.abs(a - b) === 1 ? room(x + 3, y + 0.75, 0, x + 4, y + 2.25, 2.5) : room(x + 0.75, y + 3, 0, x + 2.25, y + 4, 2.5));
  }
  return specs;
}

/** `floors` stacked 12×12×3 storeys with 1-thick slabs, linked by alternating stair shafts with ramps. */
function tower(floors: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let f = 0; f < floors; f++) {
    const z = f * 4;
    specs.push(room(0, 0, z, 12, 12, z + 3), solid(5, 5, z, 7, 7, z + 3)); // storey + central column
    if (f < floors - 1) {
      const x = f % 2 ? 0 : 9; // shaft alternates sides
      specs.push(room(x, 2, z, x + 3, 10, z + 7), ramp(x, x + 3, 2, 10, z, 4));
    }
  }
  return specs;
}

/** Hall `w × h × 5` with 1×1 full-height pillars on a staggered `pitch` grid. */
function pillarForest(w: number, h: number, pitch: number): BrushSpec[] {
  const specs: BrushSpec[] = [room(0, 0, 0, w, h, 5)];
  for (let j = 1, row = 0; j * pitch < h; j++, row++) {
    for (let x = pitch / 2 + (row % 2) * (pitch / 2); x + 1 < w; x += pitch) {
      specs.push(solid(x, j * pitch - 0.5, 0, x + 1, j * pitch + 0.5, 5));
    }
  }
  return specs;
}

/** Back-and-forth corridor of `bands` runs (2 wide, 2.5 high): a deep, narrow portal chain. */
function serpentine(bands: number, len: number): BrushSpec[] {
  const specs: BrushSpec[] = [];
  for (let j = 0; j < bands; j++) {
    specs.push(room(0, j * 4, 0, len, j * 4 + 2, 2.5));
    if (j < bands - 1) specs.push(j % 2 ? room(0, j * 4 + 2, 0, 2, j * 4 + 4, 2.5) : room(len - 2, j * 4 + 2, 0, len, j * 4 + 4, 2.5));
  }
  return specs;
}

/** Corridor with `teeth` dead-end alcoves on both sides: many small, mutually visible leaves. */
function comb(teeth: number): BrushSpec[] {
  const specs: BrushSpec[] = [room(0, 0, 0, teeth * 3, 2, 3)];
  for (let i = 0; i < teeth; i++) {
    specs.push(room(i * 3 + 1, 2, 0, i * 3 + 2, 8, 3), room(i * 3 + 1, -6, 0, i * 3 + 2, 0, 3));
  }
  return specs;
}

/** A room under a 1-thick ceiling pierced by an `n × n` vent grille into the room above. */
function grille(n: number, gap: number): BrushSpec[] {
  const specs: BrushSpec[] = [room(0, 0, 0, 12, 12, 3), room(0, 0, 4, 12, 12, 7)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * 12 - gap / 2, y = ((j + 0.5) / n) * 12 - gap / 2;
    specs.push(room(x, y, 3, x + gap, y + gap, 4));
  }
  return specs;
}

/** Hall with randomly rotated and sized prism pillars: no axis-aligned vertical planes. */
function obliqueLattice(n: number, seed: number): BrushSpec[] {
  const rand = rng(seed);
  const specs: BrushSpec[] = [room(0, 0, 0, n * 6, n * 6, 5)];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const sides = 3 + Math.floor(rand() * 4);
    specs.push({ kind: "solid", prism: ngon(i * 6 + 3, j * 6 + 3, 0.8 + rand() * 1.2, sides, rand() * Math.PI), z0: 0, z1: 1.5 + rand() * 3.5 });
  }
  return specs;
}

export const DEMO_LEVELS: readonly SampleLevel[] = [
  // ---- heavy ----
  { group: HEAVY, name: "Grid city 6×6", description: "36 rooms, each joined to its 4 neighbours: dense portal graph, long sight lines along the streets.", create: () => build(gridCity(6)) },
  { group: HEAVY, name: "Maze 10×10", description: "A perfect maze of 100 cells: many leaves, tiny PVS per leaf.", create: () => build(maze(10, 7)) },
  { group: HEAVY, name: "Tower", description: "8 storeys with central columns, joined by alternating ramp shafts.", create: () => build(tower(8)) },
  { group: HEAVY, name: "Pillar forest", description: "A 40×28 hall with ~65 staggered pillars: huge leaf count, everything partly visible.", create: () => build(pillarForest(40, 28, 4)) },
  // ---- worst cases ----
  { group: WORST, name: "Serpentine", description: "A 14-band snake corridor: the deepest possible portal chains for the flow recursion.", create: () => build(serpentine(14, 30)) },
  { group: WORST, name: "Comb", description: "A corridor with 30 alcoves: every alcove sees most of the others through the corridor.", create: () => build(comb(15)) },
  { group: WORST, name: "Vent grille", description: "Two storeys joined only by a 6×6 grille of thin vents: many tiny portals, antipenumbra stress.", create: () => build(grille(6, 0.3)) },
  { group: WORST, name: "Oblique lattice", description: "Rotated prism pillars of random heights under one open ceiling: oblique planes, near-total visibility. Slow: ~2 min of portal flow single-threaded.", create: () => build(obliqueLattice(4, 3)) },
  // ---- edge cases ----
  {
    group: EDGE, name: "Hairline gap", description: "Left pair shares a face (one room); right pair is split by a 0.01 gap (must not see each other).",
    create: () => build([room(0, 10, 0, 8, 18, 4), room(8, 10, 0, 16, 18, 4), room(0, 0, 0, 8, 8, 4), room(8.01, 0, 0, 16, 8, 4)]),
  },
  {
    group: EDGE, name: "Edge & corner kiss", description: "Rooms touching only along an edge or at a vertex (no portal expected); the stacked pair shares a face (one space).",
    create: () => build([room(0, 0, 0, 8, 8, 4), room(8, 8, 0, 16, 16, 4), room(8, 8, 4, 16, 16, 8), room(16, 0, 8, 24, 8, 12)]),
  },
  {
    group: EDGE, name: "Overlap pile", description: "Coincident, nested and overlapping rooms: CSG union must stay watertight.",
    create: () => build([
      room(0, 0, 0, 10, 10, 4), room(0, 0, 0, 10, 10, 4), room(2, 2, 1, 8, 8, 3), room(5, 5, 2, 15, 15, 6), room(10, 0, 0, 20, 5, 4),
      ...Array.from({ length: 5 }, (_, i): BrushSpec => ({ kind: "room", prism: ngon(15 + i * 1.5, 12, 4, 6, i * 0.3), z0: i * 0.5, z1: 4 + i * 0.5 })),
    ]),
  },
  {
    group: EDGE, name: "Islands", description: "Disconnected rooms, a room cut in two by a solid, and a cube floating mid-air in a room.",
    create: () => build([room(0, 0, 0, 20, 8, 4), solid(9, 0, 0, 11, 8, 4), room(0, 12, 0, 8, 20, 4), room(12, 12, 0, 20, 20, 6), solid(15, 15, 2, 17, 17, 4)]),
  },
  {
    group: EDGE, name: "Round room", description: "A 48-gon room around a 24-gon pillar: many thin faces and nearly parallel planes.",
    create: () => build([{ kind: "room", prism: ngon(0, 0, 12, 48), z0: 0, z1: 5 }, { kind: "solid", prism: ngon(0, 0, 4, 24), z0: 0, z1: 5 }]),
  },
  {
    group: EDGE, name: "Round room (detail pillar)", description: "Round room with the pillar as a detail brush: drawn, but it neither cuts the BSP nor blocks sight.",
    create: () => build([{ kind: "room", prism: ngon(0, 0, 12, 48), z0: 0, z1: 5 }, { kind: "solid", prism: ngon(0, 0, 4, 24), z0: 0, z1: 5, detail: true }]),
  },
  {
    group: EDGE, name: "Doors", description: "Three rooms in a row joined by doorways with door brushes (phase 4b); door \"loose\" leaves a gap and is reported as not sealing. Probe with \"Runtime clip: close all doors\".",
    create: () => build([
      room(0, 0, 0, 10, 10, 4), room(10, 4, 0, 14, 6, 3), room(14, 0, 0, 24, 10, 4), room(24, 3, 0, 28, 7, 3), room(28, 0, 0, 38, 10, 4),
      { kind: "solid", box: [11.5, 4, 0, 12.5, 6, 3], door: "west" },
      { kind: "solid", box: [25.5, 3, 0, 26.5, 6, 3], door: "loose" },
    ]),
  },
  {
    group: EDGE, name: "Needle", description: "A 100-long, 0.2×0.2 duct into a flat wedge: extreme aspect ratios.",
    create: () => build([
      room(-8, -4, 0, 0, 4, 4), room(0, -0.1, 1.9, 100, 0.1, 2.1),
      { kind: "room", prism: [{ x: 100, y: -0.3 }, { x: 130, y: 0 }, { x: 100, y: 0.3 }], z0: 1.8, z1: 2.2 },
    ]),
  },
  {
    group: EDGE, name: "Far from origin", description: "The Two rooms layout shifted to (4000, -3000, 500): checks tolerances at large coordinates.",
    create: () => build([room(4000, -3000, 500, 4008, -2992, 504), room(4008, -2997, 500, 4010, -2995, 502.5), room(4010, -3000, 500, 4018, -2992, 504)]),
  },
  { group: EDGE, name: "Single room", description: "One room, no portals: the trivial PVS.", create: () => build([room(0, 0, 0, 10, 6, 3)]) },
];

/** Everything the editor's level picker offers: the basic samples first, then the demos. */
export const ALL_LEVELS: readonly SampleLevel[] = [...SAMPLE_LEVELS, ...DEMO_LEVELS];
