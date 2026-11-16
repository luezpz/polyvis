import { describe, expect, it } from "vitest";
import { DEFAULT_BSP_OPTIONS, SAMPLE_LEVELS, buildBsp, buildWalls, compileLevel, compileLevelAsync, computePortalFlow, type Level } from "../../src/d3/core";
import { geometry3 } from "../../src/d3/core/geometry";
import { type BspBuildOptions, buildBspParallel, inProcessBspWorker } from "../../src/shared/core";
import { randomLevel } from "./helpers";

const levels = (): Level[] => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 30), randomLevel(21, 40)];
const workers = (k: number) => Array.from({ length: k }, () => inProcessBspWorker(geometry3));
const walls = (level: Level) => buildWalls(level.brushes);

describe("parallel BSP build", () => {
  it("builds the same tree as the sequential build, for any worker count and options", async () => {
    const variants: Partial<BspBuildOptions>[] = [{}, { cornerSplits: false, maxCellSize: 0 }, { maxCellSize: 4 }];
    for (const level of levels()) {
      const w = walls(level);
      for (const v of variants) {
        const opts = { ...DEFAULT_BSP_OPTIONS, ...v };
        const seq = buildBsp(w, opts);
        for (const k of [1, 3, 8]) {
          const par = await buildBspParallel(geometry3, w, opts, workers(k));
          expect(par.stats).toEqual(seq.stats);
          expect(par.tree).toEqual(seq.tree);
        }
      }
    }
  });

  it("handles a level without walls", async () => {
    const opts = DEFAULT_BSP_OPTIONS;
    expect(await buildBspParallel(geometry3, [], opts, workers(2))).toEqual(buildBsp([], opts));
  });

  it("compileLevelAsync with a parallel BSP runner gives the same PVS as compileLevel", async () => {
    const pool = workers(4);
    for (const level of SAMPLE_LEVELS.map((s) => s.create())) {
      const sync = compileLevel(level);
      const r = await compileLevelAsync(level, {}, async (graph, mightSee, opts) => computePortalFlow(graph, mightSee, opts),
        (w, opts) => buildBspParallel(geometry3, w, opts, pool));
      expect(r.tree).toEqual(sync.tree);
      expect(r.pvs.every((row, i) => row.equals(sync.pvs[i]))).toBe(true);
    }
  });
});
