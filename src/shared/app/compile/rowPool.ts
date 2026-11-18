/**
 * Base vis and the passage table on the shared {@link WorkerPool}, through the one row protocol
 * (`rowProtocol.ts`). Small graphs and environments without nested workers run on one thread.
 */

import { type BaseVisRunner, type Dim, type Geometry, type PassageRunner, type RowWorker, computeBaseVis, computeBaseVisParallel, computePassages, computePassagesParallel } from "../../core";
import { poolRunner } from "./poolRunner";
import type { PoolCall, WorkerPool } from "./workerPool";

/** Below this many portals either stage takes a few ms; cloning the graph to workers costs more. */
const MIN_PARALLEL_PORTALS = 200;

/** One pool worker as a {@link RowWorker}. */
function poolRowWorker(call: PoolCall): RowWorker {
  return {
    async begin(job, graph, mightSee) { await call({ type: "rows-begin", job, graph, mightSee }); },
    async rows(p0, p1) { return (await call<{ words: Uint32Array }>({ type: "rows", p0, p1 })).words; },
  };
}

/** A {@link BaseVisRunner} on `pool`; `geometry` is for the single-threaded path, also used if the pool fails. */
export function createParallelBaseVisRunner<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): BaseVisRunner<D> {
  return poolRunner(pool, "base vis", (graph) => graph.portals.length >= MIN_PARALLEL_PORTALS,
    (graph) => computeBaseVis(geometry, graph),
    (calls, graph) => computeBaseVisParallel(geometry, graph, calls.map(poolRowWorker)));
}

/** A {@link PassageRunner} on `pool`; `geometry` is for the single-threaded path, also used if the pool fails. */
export function createParallelPassageRunner<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): PassageRunner<D> {
  return poolRunner(pool, "passage build", (graph) => graph.portals.length >= MIN_PARALLEL_PORTALS,
    (graph, mightSee) => computePassages(geometry, graph, mightSee),
    (calls, graph, mightSee) => computePassagesParallel(geometry, graph, mightSee, calls.map(poolRowWorker)));
}
