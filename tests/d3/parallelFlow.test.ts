import { describe, expect, it } from "vitest";
import { SAMPLE_LEVELS, compileLevel, compileLevelAsync, type Level } from "../../src/d3/core";
import { geometry3 } from "../../src/d3/core/geometry";
import { type BitSet, computePortalFlowParallel, inProcessFlowWorker } from "../../src/shared/core";
import { randomLevel } from "./helpers";

const levels = (): Level[] => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7), randomLevel(21)];
const workers = (k: number) => Array.from({ length: k }, () => inProcessFlowWorker(geometry3));
const same = (a: readonly BitSet[], b: readonly BitSet[]) => a.length === b.length && a.every((row, i) => row.equals(b[i]));
const subset = (a: readonly BitSet[], b: readonly BitSet[]) => a.every((row, i) => !row.hasAnyNotIn(b[i]));

describe("parallel portal flow (dependency scheduling)", () => {
  it("matches the single-threaded flow bit for bit, for any worker count", async () => {
    for (const level of levels()) {
      const r = compileLevel(level);
      for (const k of [1, 2, 5]) {
        const p = await computePortalFlowParallel(r.graph, r.mightSee, workers(k), {});
        expect(same(p.portalVis, r.portalVis)).toBe(true);
        expect(p.stats.steps).toBe(r.flowStats.steps);
        expect(p.stats.truncated).toBe(false);
      }
    }
  });

  it("finds independent sources to run concurrently", async () => {
    const r = compileLevel(SAMPLE_LEVELS[0].create());
    const p = await computePortalFlowParallel(r.graph, r.mightSee, workers(4), {});
    expect(p.parallel.maxReady).toBeGreaterThan(1);
  });

  it("compileLevelAsync with a parallel runner gives the same PVS as compileLevel", async () => {
    for (const level of levels()) {
      const sync = compileLevel(level);
      const pool = workers(3);
      const r = await compileLevelAsync(level, {}, (graph, mightSee, opts) => computePortalFlowParallel(graph, mightSee, pool, opts));
      expect(same(r.pvs, sync.pvs)).toBe(true);
      expect(r.timings.some((t) => t.stage === "portal flow")).toBe(true);
    }
  });

  it("truncated flow falls back to base vis (still conservative)", async () => {
    const r = compileLevel(SAMPLE_LEVELS[0].create());
    const p = await computePortalFlowParallel(r.graph, r.mightSee, workers(2), { maxSteps: 50 });
    expect(p.stats.truncated).toBe(true);
    expect(subset(r.portalVis, p.portalVis)).toBe(true);
    expect(subset(p.portalVis, r.mightSee)).toBe(true);
  });
});
