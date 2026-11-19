/**
 * Runtime portal clipping benchmark (docs/OPTIMIZATION-PLAN.md, phase 4): per compiled level, times
 * `visibleLeaves` from seeded random eyes in both clip modes, omnidirectional and through a 90° camera,
 * plus `packRuntime`. Columns per mode: mean / max µs per query, mean visible leaves, mean and max
 * portal crossings (summed over paths: shows the per-path blowup on open levels).
 */

import * as d2 from "../src/d2/core";
import * as d3 from "../src/d3/core";
import { geometry2 } from "../src/d2/core/geometry";
import { geometry3 } from "../src/d3/core/geometry";
import { type ClipMode, type CompileResult, type Dim, type Geometry, type View, locateLeaf, rng, packRuntime, visibleLeaves } from "../src/shared/core";

/** Eyes sampled per level (each query mode runs once per eye). */
const EYES = 64;

interface Mode {
  readonly name: string;
  readonly clip: ClipMode;
  readonly camera: boolean;
}

const MODES: readonly Mode[] = [
  { name: "planes omni", clip: "planes", camera: false },
  { name: "rect omni", clip: "rect", camera: false },
  { name: "planes cam", clip: "planes", camera: true },
  { name: "rect cam", clip: "rect", camera: true },
];

/** Table header for {@link runtimeRow} (one group of columns per mode). */
export function runtimeHeader(): string[] {
  return ["level", "compile ms", "leaves", "eyes", "mean pvs (base = flow truncated)", "pack ms",
    ...MODES.flatMap((m) => [`${m.name} µs`, `${m.name} max µs`, `${m.name} visible`, `${m.name} crossings`, `${m.name} max crossings`])];
}

/** Random point inside convex cell `cell`: a random convex combination of its vertices. */
function pointInCell<D extends Dim>(g: Geometry<D>, cell: D["cell"], rand: () => number) {
  const verts = g.cellVertices(cell).map((v) => g.coords(v));
  const w = verts.map(() => rand());
  const sum = w.reduce((a, b) => a + b, 0);
  return g.vecAt(verts[0].map((_, i) => verts.reduce((s, v, k) => s + v[i] * w[k], 0) / sum), 0);
}

/** A random camera direction for dimension `g.dimension` (3D: pitch within ±30°). */
function randomView(dim: number, rand: () => number): View<Dim> {
  const t = rand() * 2 * Math.PI;
  if (dim === 2) return d2.viewToward({ x: Math.cos(t), y: Math.sin(t) }) as View<Dim>;
  return d3.viewToward({ x: Math.cos(t), y: Math.sin(t), z: (rand() - 0.5) * 1.15 }) as View<Dim>;
}

/** One table row for compiled level `r` named `name` (seeded: rows are reproducible). */
export function runtimeRow(name: string, r: CompileResult<Dim>): (string | number)[] {
  const g = (r.tree.bounds.min as { z?: number }).z === undefined ? geometry2 : geometry3;
  const geo = g as unknown as Geometry<Dim>;
  const rand = rng(1234);
  const empty = r.tree.leaves.flatMap((l, i) => (l.contents === "empty" && l.region ? [i] : []));
  const eyes = Array.from({ length: EYES }, () => {
    const leaf = empty[Math.floor(rand() * empty.length)];
    return { leaf, eye: pointInCell(geo, r.tree.leaves[leaf].region!, rand), view: randomView(geo.dimension, rand) };
  }).filter((e) => locateLeaf(geo, r.tree, e.eye) === e.leaf); // drop eyes on a boundary that land in a neighbour

  const t0 = performance.now();
  packRuntime(geo, r.graph, r.pvsTable);
  const packMs = performance.now() - t0;

  const cols = MODES.flatMap((m) => {
    let time = 0, maxTime = 0, visible = 0, crossings = 0, maxCrossings = 0;
    for (const { leaf, eye, view } of eyes) {
      const stats = { crossings: 0 };
      const s = performance.now();
      const vis = visibleLeaves(geo, r.graph, leaf, eye, { clip: m.clip, view: m.camera ? view : undefined, pvsRow: r.pvs[leaf], stats });
      const dt = (performance.now() - s) * 1000;
      time += dt; maxTime = Math.max(maxTime, dt);
      visible += vis.count();
      crossings += stats.crossings; maxCrossings = Math.max(maxCrossings, stats.crossings);
    }
    const n = Math.max(1, eyes.length);
    return [(time / n).toFixed(0), maxTime.toFixed(0), (visible / n).toFixed(1), (crossings / n).toFixed(0), maxCrossings];
  });
  const meanPvs = eyes.reduce((s, e) => s + r.pvs[e.leaf].count(), 0) / Math.max(1, eyes.length);
  return [name, r.timings.reduce((t, x) => t + x.ms, 0).toFixed(0), r.pvs.length, eyes.length, meanPvs.toFixed(1) + (r.flowStats.truncated ? " (base)" : ""), packMs.toFixed(1), ...cols];
}
