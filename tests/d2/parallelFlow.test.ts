import { describe, expect, it } from "vitest";
import { SAMPLE_LEVELS, compileLevel, compileLevelAsync, type Level } from "../../src/d2/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { type BitSet, computePortalFlowParallel, inProcessFlowWorker } from "../../src/shared/core";
import { randomLevel } from "./helpers";

const levels = (): Level[] => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)];
const workers = (k: number) => Array.from({ length: k }, () => inProcessFlowWorker(geometry2));
const same = (a: readonly BitSet[], b: readonly BitSet[]) => a.length === b.length && a.every((row, i) => row.equals(b[i]));
const subset = (a: readonly BitSet[], b: readonly BitSet[]) => a.every((row, i) => !row.hasAnyNotIn(b[i]));

describe("parallel portal flow (dependency scheduling)", () => {
  it("matches the single-threaded flow bit for bit, for any worker count", async () => {
    for (const level of levels()) {
      const r = compileLevel(level);
      for (const k of [1, 2, 5]) {
        const p = await computePortalFlowParallel(r.graph, r.mightSee, workers(k), {});
        expect(same(p.portalVis, r.portalVis)).toBe(true);
        expect(p.stats).toEqual(r.flowStats); // counters aggregate the same way
        expect(p.stats.truncated).toBe(false);
      }
    }
  });

  it("matches the single-threaded flow with passages (2b)", async () => {
    for (const level of levels()) {
      const r = compileLevel(level, { baseVis: "passages" });
      const base = compileLevel(level).mightSee;
      const { computePassages } = await import("../../src/d2/core/vis/vis");
      const passages = computePassages(r.graph, base)!;
      const p = await computePortalFlowParallel(r.graph, r.mightSee, workers(3), { passages, orderBy: base });
      expect(same(p.portalVis, r.portalVis)).toBe(true);
      expect(p.stats).toEqual(r.flowStats);
    }
  });

  it("counts the flow's clip calls", () => {
    const { flowStats: f } = compileLevel(SAMPLE_LEVELS[0].create());
    expect(f.facetClips).toBeGreaterThanOrEqual(f.steps); // step 1 always runs, step 2 if 1 survives
    expect(f.facetClips).toBeLessThanOrEqual(2 * f.steps);
    expect(f.separatorClips).toBeGreaterThan(0);
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
      const r = await compileLevelAsync(level, {}, { flow: (graph, mightSee, opts) => computePortalFlowParallel(graph, mightSee, pool, opts) });
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
