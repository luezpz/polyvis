/**
 * Every pool-backed stage runner of one dimension, for its compile worker: one place to wire a new
 * parallel stage into both editors.
 */

import type { Dim, Geometry, StageRunners } from "../../core";
import { createParallelBspRunner } from "./bspPool";
import { createParallelFlowRunner } from "./flowPool";
import { createParallelBaseVisRunner, createParallelPassageRunner } from "./rowPool";
import type { WorkerPool } from "./workerPool";

/** BSP, base vis, passage table and flow runners on `pool`, each falling back to one thread with `geometry`. */
export function createPoolRunners<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): StageRunners<D> {
  return {
    bsp: createParallelBspRunner(geometry, pool),
    baseVis: createParallelBaseVisRunner(geometry, pool),
    passages: createParallelPassageRunner(geometry, pool),
    flow: createParallelFlowRunner(geometry, pool),
  };
}
