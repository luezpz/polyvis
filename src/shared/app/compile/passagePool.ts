/**
 * The parallel passage table build on the shared {@link WorkerPool}. Small graphs and
 * environments without nested workers build it single-threaded instead.
 */

import { type Dim, type Geometry, type PassageRunner, type PassageWorker, computePassages, computePassagesParallel } from "../../core";
import type { PoolCall, WorkerPool } from "./workerPool";

/** Below this many portals the table builds in a few ms; cloning the graph to workers costs more. */
const MIN_PARALLEL_PORTALS = 200;

/** One pool worker as a {@link PassageWorker}. */
function poolPassageWorker(call: PoolCall): PassageWorker {
  return {
    async begin(graph, mightSee) { await call({ type: "passage-begin", graph, mightSee }); },
    async rows(p0, p1) { return (await call<{ words: Uint32Array }>({ type: "passage-rows", p0, p1 })).words; },
  };
}

/** A {@link PassageRunner} on `pool`; `geometry` is for the single-threaded path, also used if the pool fails. */
export function createParallelPassageRunner<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): PassageRunner<D> {
  return async (graph, mightSee) => {
    const calls = graph.portals.length >= MIN_PARALLEL_PORTALS ? pool.workers() : null;
    if (!calls) return computePassages(geometry, graph, mightSee);
    try {
      return await computePassagesParallel(geometry, graph, mightSee, calls.map(poolPassageWorker));
    } catch (e) {
      console.warn("Parallel passage build failed, using one thread", e);
      pool.markBroken();
      return computePassages(geometry, graph, mightSee);
    }
  };
}
