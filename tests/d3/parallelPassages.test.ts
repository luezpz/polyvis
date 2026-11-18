import { describe, expect, it } from "vitest";
import { SAMPLE_LEVELS, compileLevel, compileLevelAsync } from "../../src/d3/core";
import { geometry3 } from "../../src/d3/core/geometry";
import { BitSet, computePassages, passageCosts, packPortalGraph, unpackPortalGraph, computePassagesParallel, computePortalFlow, inProcessPassageWorker, passageChunks } from "../../src/shared/core";
import { randomLevel } from "./helpers";

const levels = () => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)];
const workers = (k: number) => Array.from({ length: k }, () => inProcessPassageWorker(geometry3));

describe("parallel passage table", () => {
  it("equals the single-threaded table for any worker count", async () => {
    for (const level of levels()) {
      const { graph, mightSee } = compileLevel(level);
      const one = computePassages(geometry3, graph, mightSee);
      for (const k of [1, 2, 5]) expect(await computePassagesParallel(geometry3, graph, mightSee, workers(k), 0)).toEqual(one);
    }
  });

  it("small tables skip the workers; the default threshold still gives the same table", async () => {
    let begun = 0;
    const counting = workers(4).map((w) => ({ ...w, begin: (g: Float64Array, m: Uint32Array) => { begun++; return w.begin(g, m); } }));
    const { graph, mightSee } = compileLevel(SAMPLE_LEVELS[0].create());
    expect(await computePassagesParallel(geometry3, graph, mightSee, counting)).toEqual(computePassages(geometry3, graph, mightSee));
    expect(begun).toBe(0);
    expect(await computePassagesParallel(geometry3, graph, mightSee, counting, 1)).toEqual(computePassages(geometry3, graph, mightSee));
    expect(begun).toBeGreaterThan(1);
  });

  it("packs the portal graph and mightSee rows losslessly", () => {
    for (const level of levels()) {
      const { graph, mightSee } = compileLevel(level);
      expect(unpackPortalGraph(geometry3, packPortalGraph(geometry3, graph))).toEqual(graph);
      const rows = BitSet.unpackRows(graph.portals.length, BitSet.packRows(mightSee));
      expect(rows.length).toBe(mightSee.length);
      rows.forEach((r, i) => expect(r.equals(mightSee[i])).toBe(true));
    }
  });

  it("chunks cover every portal once, in order, none empty", () => {
    const { graph, mightSee } = compileLevel(randomLevel(21, 8));
    const cost = passageCosts(geometry3, graph, mightSee);
    for (const count of [1, 3, 16, 10_000]) {
      const start = passageChunks(cost, count);
      expect(start[0]).toBe(0);
      expect(start[start.length - 1]).toBe(graph.portals.length);
      for (let i = 1; i < start.length; i++) expect(start[i]).toBeGreaterThan(start[i - 1]);
      expect(start.length - 1).toBeLessThanOrEqual(Math.max(1, count));
    }
  });

  it("compileLevelAsync with a passage runner gives the same result as compileLevel", async () => {
    for (const level of levels()) {
      const sync = compileLevel(level, { baseVis: "passages" });
      const async_ = await compileLevelAsync(level, { baseVis: "passages" }, async (g, m, o) => computePortalFlow(geometry3, g, m, o), undefined,
        (g, m) => computePassagesParallel(geometry3, g, m, workers(3), 0));
      expect(async_.pvs).toEqual(sync.pvs);
      expect(async_.portalVis).toEqual(sync.portalVis);
      expect(async_.flowStats).toEqual(sync.flowStats);
      expect(async_.timings.some((t) => t.stage === "passage vis")).toBe(true);
    }
  });
});
