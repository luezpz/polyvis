import { describe, expect, it } from "vitest";
import { SAMPLE_LEVELS, compileLevel, compileLevelAsync } from "../../src/d2/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { computeBaseVis, computeBaseVisParallel, computePortalFlow, inProcessRowWorker } from "../../src/shared/core";
import { randomLevel } from "./helpers";

const levels = () => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)];
const workers = (k: number) => Array.from({ length: k }, () => inProcessRowWorker(geometry2));

describe("parallel base vis", () => {
  it("equals the single-threaded rows for any worker count", async () => {
    for (const level of levels()) {
      const { graph, mightSee } = compileLevel(level);
      expect(computeBaseVis(geometry2, graph)).toEqual(mightSee);
      for (const k of [1, 2, 5]) expect(await computeBaseVisParallel(geometry2, graph, workers(k), 0)).toEqual(mightSee);
    }
  });

  it("rows own their buffers (no shared buffer cloned per row)", async () => {
    const { graph } = compileLevel(randomLevel(7, 8));
    const rows = await computeBaseVisParallel(geometry2, graph, workers(3), 0);
    for (const r of rows) expect(r.words.byteLength).toBe(r.words.buffer.byteLength);
  });

  it("small graphs skip the workers", async () => {
    let begun = 0;
    const counting = workers(4).map((w) => ({ ...w, begin: (...a: Parameters<typeof w.begin>) => { begun++; return w.begin(...a); } }));
    const { graph, mightSee } = compileLevel(SAMPLE_LEVELS[0].create());
    expect(await computeBaseVisParallel(geometry2, graph, counting)).toEqual(mightSee);
    expect(begun).toBe(0);
  });

  it("compileLevelAsync with a base vis runner gives the same result as compileLevel", async () => {
    for (const baseVis of ["planes", "passages"] as const) {
      for (const level of levels()) {
        const sync = compileLevel(level, { baseVis });
        const async_ = await compileLevelAsync(level, { baseVis }, {
          flow: async (g, m, o) => computePortalFlow(geometry2, g, m, o),
          baseVis: (g) => computeBaseVisParallel(geometry2, g, workers(3), 0),
        });
        expect(async_.mightSee).toEqual(sync.mightSee);
        expect(async_.pvs).toEqual(sync.pvs);
        expect(async_.flowStats).toEqual(sync.flowStats);
      }
    }
  });
});
