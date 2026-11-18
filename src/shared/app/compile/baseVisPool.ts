/**
 * Parallel base vis on the shared {@link WorkerPool}. Small graphs and environments without
 * nested workers compute it single-threaded instead.
 */

import { type BaseVisRunner, type BaseVisWorker, type Dim, type Geometry, computeBaseVis, computeBaseVisParallel } from "../../core";
import type { PoolCall, WorkerPool } from "./workerPool";

/** Below this many portals base vis takes a few ms; cloning the graph to workers costs more. */
const MIN_PARALLEL_PORTALS = 200;

/** One pool worker as a {@link BaseVisWorker}. */
function poolBaseVisWorker(call: PoolCall): BaseVisWorker {
  return {
    async begin(graph) { await call({ type: "basevis-begin", graph }); },
    async rows(p0, p1) { return (await call<{ words: Uint32Array }>({ type: "basevis-rows", p0, p1 })).words; },
  };
}

/** A {@link BaseVisRunner} on `pool`; `geometry` is for the single-threaded path, also used if the pool fails. */
export function createParallelBaseVisRunner<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): BaseVisRunner<D> {
  return async (graph) => {
    const calls = graph.portals.length >= MIN_PARALLEL_PORTALS ? pool.workers() : null;
    if (!calls) return computeBaseVis(geometry, graph);
    try {
      return await computeBaseVisParallel(geometry, graph, calls.map(poolBaseVisWorker));
    } catch (e) {
      console.warn("Parallel base vis failed, using one thread", e);
      pool.markBroken();
      return computeBaseVis(geometry, graph);
    }
  };
}
