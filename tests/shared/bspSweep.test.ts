/**
 * The BSP splitter sweep (`bsp/sweep.ts`) must give bit-identical scores to the
 * per-candidate loop, in both kernels, so the tree never changes.
 */

import { describe, expect, it } from "vitest";
import { type BspBuildOptions, type Dim, type Fragment, type Geometry, PLANE_EPSILON, type Plane, type Wall, partition, prepareBuild, scoreSplitters, splitCandidates } from "../../src/shared/core";
import { sweepScores } from "../../src/shared/core/bsp/sweep";
import { ALL_LEVELS as LEVELS_2D, DEFAULT_BSP_OPTIONS as OPTS_2D, buildWalls as walls2 } from "../../src/d2/core";
import { ALL_LEVELS as LEVELS_3D, DEFAULT_BSP_OPTIONS as OPTS_3D, buildWalls as walls3 } from "../../src/d3/core";
import { type Dim2, geometry2 } from "../../src/d2/core/geometry";
import { type Dim3, geometry3 } from "../../src/d3/core/geometry";
import type { Segment } from "../../src/d2/core/math/segment";
import type { Winding } from "../../src/d3/core/math/winding";

/** Seeded LCG in [0, 1) so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Moves every vertex by a random multiple of eps/3 (≤ 2 eps) on each axis: stresses the "on" tolerance band. */
const jitter2 = (rand: () => number) => (s: Segment): Segment => {
  const j = () => Math.round((rand() - 0.5) * 12) * (PLANE_EPSILON / 3);
  return { a: { x: s.a.x + j(), y: s.a.y + j() }, b: { x: s.b.x + j(), y: s.b.y + j() } };
};
const jitter3 = (rand: () => number) => (w: Winding): Winding => {
  const j = () => Math.round((rand() - 0.5) * 12) * (PLANE_EPSILON / 3);
  return w.map((p) => ({ x: p.x + j(), y: p.y + j(), z: p.z + j() }));
};

/**
 * Walks the top of the build (up to `maxNodes` nodes, front first) and checks, at every node, that each
 * swept candidate score equals the per-candidate reference. Returns the number of swept scores compared.
 */
function checkTree<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], opts: BspBuildOptions, maxNodes: number): number {
  const ctx = prepareBuild(g, walls, opts);
  const planes: readonly Plane<D>[] = ctx.planes;
  let nodes = 0, compared = 0;
  const visit = (frags: readonly Fragment<D>[]): void => {
    if (frags.length === 0 || nodes++ >= maxNodes) return;
    const candidates = splitCandidates(frags, ctx.planeRank);
    const swept = sweepScores(g, frags, candidates, planes, opts);
    for (const [c, score] of swept) {
      expect(score, `candidate ${c}`).toBe(scoreSplitters(g, frags, [c], planes, opts, null, false).score);
      compared++;
    }
    const best = scoreSplitters(g, frags, candidates, planes, opts);
    expect(best).toEqual(scoreSplitters(g, frags, candidates, planes, opts, null, false));
    const part = partition(g, frags, best.plane, planes);
    visit(part.front);
    visit(part.back);
  };
  visit(ctx.fragments);
  return compared;
}

type Case = { name: string; run: (opts: Partial<BspBuildOptions>, jitterSeed: number | null) => number };

const cases: Case[] = [
  ...LEVELS_2D.map((l): Case => ({
    name: `2D ${l.name}`,
    run: (o, seed) => {
      const walls = walls2(l.create().brushes);
      const moved = seed === null ? walls : walls.map((w) => ({ ...w, winding: jitter2(rng(seed))(w.winding) }));
      return checkTree<Dim2>(geometry2, moved, { ...OPTS_2D, ...o }, 60);
    },
  })),
  ...LEVELS_3D.filter((l) => !l.name.includes("Oblique")).map((l): Case => ({
    name: `3D ${l.name}`,
    run: (o, seed) => {
      const walls = walls3(l.create().brushes);
      const moved = seed === null ? walls : walls.map((w) => ({ ...w, winding: jitter3(rng(seed))(w.winding) }));
      return checkTree<Dim3>(geometry3, moved, { ...OPTS_3D, ...o }, 60);
    },
  })),
];

describe("BSP splitter sweep", () => {
  // Levels without 4+ parallel candidates sweep nothing; the grid levels below must sweep.
  const counts = new Map<string, number>();
  it.each(cases)("$name: swept scores equal the per-candidate loop", ({ name, run }) => {
    counts.set(name, run({}, null) + run({ facingWeight: 2 }, null) + run({}, 7));
  });
  it("axis-aligned levels actually use the sweep", () => {
    for (const name of ["2D Maze 16×16", "3D Maze 10×10"]) expect(counts.get(name), name).toBeGreaterThan(100);
  });
});
