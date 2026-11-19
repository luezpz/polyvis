/**
 * Face split bias (phase 3d hint faces), both kernels: brush face → CSG wall → BSP splitter score.
 * A negative bias makes a plane the preferred splitter, a positive one avoids it; every build path
 * (sweep, parallel, incremental) must agree, and the bias must survive packing, CSG dedupe, edits and JSON.
 */

import { describe, expect, it } from "vitest";
import {
  type BspBuildOptions, type BspCache, type Dim, type IncrementalBspResult, type Geometry, type Wall,
  buildBsp, buildBspIncremental, buildBspParallel, inProcessBspWorker, packWalls, prepareBuild, rng, scoreSplitters, splitCandidates, unpackWalls,
} from "../../src/shared/core";
import * as d2 from "../../src/d2/core";
import * as d3 from "../../src/d3/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";
import * as b2 from "../../src/d2/core/level/builder";
import * as b3 from "../../src/d3/core/level/builder";

interface Case<D extends Dim> {
  readonly name: string;
  readonly g: Geometry<D>;
  readonly opts: BspBuildOptions;
  readonly walls: readonly Wall<D>[];
}

const NAMES = new Set(["Complex", "Pillar forest", "Maze 10×10", "Tower"]);
const cases: Case<Dim>[] = [
  ...d2.ALL_LEVELS.filter((l) => NAMES.has(l.name)).map((l) => ({ name: `2D ${l.name}`, g: geometry2, opts: d2.DEFAULT_BSP_OPTIONS, walls: d2.buildWalls(l.create().brushes) }) as unknown as Case<Dim>),
  ...d3.ALL_LEVELS.filter((l) => NAMES.has(l.name)).map((l) => ({ name: `3D ${l.name}`, g: geometry3, opts: d3.DEFAULT_BSP_OPTIONS, walls: d3.buildWalls(l.create().brushes) }) as unknown as Case<Dim>),
];

/** `walls` with a random bias (−8..8, about half 0) per wall, seeded. */
function randomBiases<D extends Dim>(walls: readonly Wall<D>[], seed: number): Wall<D>[] {
  const r = rng(seed);
  return walls.map((w) => (r() < 0.5 ? w : { ...w, splitBias: Math.round(r() * 16 - 8) || 1 }));
}

/** `walls` with `bias` on every wall whose plane is (oriented) equal to `plane`. */
function biasPlane<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], plane: Wall<D>["plane"], bias: number): Wall<D>[] {
  return walls.map((w) => (g.sameOrientedPlane(w.plane, plane) ? { ...w, splitBias: bias } : w));
}

describe.each(cases)("split bias in the BSP: $name", ({ g, opts, walls }) => {
  const rootPlane = (ws: readonly Wall<Dim>[]) => { const t = buildBsp(g, ws, opts).tree; return t.planes[t.nodes[0].plane]; };

  it("no votes: no bias table and the same tree", () => {
    expect(prepareBuild(g, walls, opts).planeBias).toBeNull();
    expect(buildBsp(g, walls.map((w) => ({ ...w, splitBias: 0 })), opts).tree).toEqual(buildBsp(g, walls, opts).tree);
  });

  it("a strongly preferred plane becomes the root; a strongly avoided root is replaced", () => {
    const root = rootPlane(walls);
    const other = walls.find((w) => !g.sameOrientedPlane(w.plane, root))!.plane;
    expect(g.sameOrientedPlane(rootPlane(biasPlane(g, walls, other, -1e6)), other)).toBe(true);
    expect(g.sameOrientedPlane(rootPlane(biasPlane(g, walls, root, 1e6)), root)).toBe(false);
  });

  it("a plane takes the lowest vote of its walls", () => {
    const root = rootPlane(walls);
    const on = walls.flatMap((w, i) => (g.sameOrientedPlane(w.plane, root) ? [i] : []));
    const ws = walls.map((w, i) => (i === on[0] ? { ...w, splitBias: 5 } : i === on[on.length - 1] && on.length > 1 ? { ...w, splitBias: -3 } : w));
    const ctx = prepareBuild(g, ws, opts);
    expect(ctx.planeBias![ctx.fragments[on[0]].plane]).toBe(on.length > 1 ? -3 : 5);
  });

  it("sweep scores equal the per-candidate loop", () => {
    const ws = randomBiases(walls, 3);
    const ctx = prepareBuild(g, ws, opts);
    const candidates = splitCandidates(ctx.fragments, ctx.planeRank);
    for (const c of candidates) {
      expect(scoreSplitters(g, ctx.fragments, [c], ctx.planes, opts, ctx.planeBias, true).score).toBe(scoreSplitters(g, ctx.fragments, [c], ctx.planes, opts, ctx.planeBias, false).score);
    }
    expect(scoreSplitters(g, ctx.fragments, candidates, ctx.planes, opts, ctx.planeBias)).toEqual(scoreSplitters(g, ctx.fragments, candidates, ctx.planes, opts, ctx.planeBias, false));
  });

  it("parallel build equals the sequential one", async () => {
    const ws = randomBiases(walls, 5);
    const seq = buildBsp(g, ws, opts);
    const par = await buildBspParallel(g, ws, opts, Array.from({ length: 3 }, () => inProcessBspWorker(g)));
    expect(par.tree).toEqual(seq.tree);
    expect(par.stats).toEqual(seq.stats);
  });

  it("incremental build equals a fresh one across bias changes", () => {
    const o = { ...opts, cornerSplits: false, maxCellSize: 0 };
    let cache: BspCache<Dim> | null = null;
    for (const seed of [0, 11, 11, 12]) {
      const ws = seed ? randomBiases(walls, seed) : walls;
      const inc: IncrementalBspResult<Dim> = buildBspIncremental(g, ws, o, cache);
      expect(inc.result.tree).toEqual(buildBsp(g, ws, o).tree);
      cache = inc.cache;
    }
  });

  it("survives packing for the workers", () => {
    const ws = randomBiases(walls, 9);
    expect(unpackWalls(g, packWalls(g, ws))).toEqual(ws);
  });
});

describe("face split bias on 3D brushes", () => {
  const { build, room, solid } = b3;

  it("CSG walls carry their face's bias; a coincident duplicate keeps the lowest vote", () => {
    const pillar = solid(4, 4, 0, 6, 6, 3);
    const level = build([room(0, 0, 0, 10, 10, 3), { ...pillar, faceSplitBias: [0, -2, 0, 0, 0, 0] }, { ...pillar, faceSplitBias: [0, -5, 0, 0, 0, 0] }]);
    const walls = d3.buildWalls(level.brushes);
    const plusX = walls.filter((w) => w.plane.n.x > 0.99 && Math.abs(w.plane.d - 6) < 1e-9); // pillar +x face (normal into empty space)
    expect(plusX.length).toBeGreaterThan(0);
    for (const w of plusX) expect(w.splitBias).toBe(-5);
    expect(walls.filter((w) => w.splitBias !== undefined)).toHaveLength(plusX.length);
  });

  it("geometry edits carry the bias by normal; JSON round-trips; bad lengths are rejected", () => {
    const level = build([{ ...room(0, 0, 0, 10, 10, 3), faceSplitBias: [1, 2, 3, 4, 5, 6] }]);
    const b = level.brushes[0];
    const moved = d3.moveBrushFace(b, 1, 2)!;
    expect(moved.faceSplitBias).toEqual(moved.planes.map((p) => b.faceSplitBias![b.planes.findIndex((q) => d3.dot(p.n, q.n) > 0.999)]));
    expect(d3.translateBrush(b, { x: 1, y: 2, z: 3 })!.faceSplitBias).toEqual(b.faceSplitBias);
    const parsed = d3.parseLevel(d3.serializeLevel(level));
    expect(parsed.brushes[0].faceSplitBias).toEqual(b.faceSplitBias);
    const bad = JSON.parse(d3.serializeLevel(level));
    bad.brushes[0].faceSplitBias = [1, 2];
    expect(() => d3.parseLevel(JSON.stringify(bad))).toThrow(/faceSplitBias/);
    expect(build([room(0, 0, 0, 1, 1, 1)]).brushes[0].faceSplitBias).toBeUndefined();
  });

  it("the hint-rows demo compiles to fewer portals than the plain one", () => {
    const portals = (name: string) => d3.compileLevel(d3.ALL_LEVELS.find((l) => l.name === name)!.create()).graph.portals.length;
    expect(portals("Pillar forest (hint rows)")).toBeLessThan(portals("Pillar forest"));
  });
});

describe("face split bias on 2D brushes", () => {
  const { build, room, solid } = b2;

  it("box edge order is −y, +x, +y, −x and CSG walls carry it", () => {
    const level = build([room(0, 0, 10, 10), { ...solid(4, 4, 6, 6), faceSplitBias: [-1, -2, -3, -4] }]);
    const walls = d2.buildWalls(level.brushes);
    const at = (nx: number, ny: number) => walls.find((w) => w.sourceId === 2 && w.plane.n.x * nx + w.plane.n.y * ny > 0.99)!.splitBias;
    // Wall normals point into empty space, i.e. out of the solid.
    expect([at(0, -1), at(1, 0), at(0, 1), at(-1, 0)]).toEqual([-1, -2, -3, -4]);
  });

  it("edge moves carry the bias by direction; JSON round-trips", () => {
    const level = build([{ ...room(0, 0, 10, 10), faceSplitBias: [1, 2, 3, 4] }]);
    const b = level.brushes[0];
    expect(d2.moveBrushEdge(b, 1, 3)!.faceSplitBias).toEqual([1, 2, 3, 4]);
    expect(d2.parseLevel(d2.serializeLevel(level)).brushes[0].faceSplitBias).toEqual([1, 2, 3, 4]);
  });

  it("the hint-rows demo compiles to fewer portals than the plain one", () => {
    const portals = (name: string) => d2.compileLevel(d2.ALL_LEVELS.find((l) => l.name === name)!.create()).graph.portals.length;
    expect(portals("Pillar forest (hint rows)")).toBeLessThan(portals("Pillar forest"));
  });
});
