/**
 * The parallel portal flow on the shared {@link WorkerPool}. Small graphs and
 * environments without nested workers use the single-threaded flow instead.
 */

import { type Dim, type FlowRunner, type FlowWorker, type Geometry, computePortalFlow, computePortalFlowParallel } from "../../core";
import { type FlowResponse, toBitSet } from "./flowProtocol";
import { poolRunner } from "./poolRunner";
import type { PoolCall, WorkerPool } from "./workerPool";

/** Below this many portals, worker start-up and cloning cost more than they save. */
const MIN_PARALLEL_PORTALS = 200;

/** One pool worker as a {@link FlowWorker}. */
function poolFlowWorker(call: PoolCall): FlowWorker {
  return {
    async begin(graph, mightSee, clipSource, rank, passages) {
      await call({ type: "begin", graph, mightSee, clipSource, rank, passages });
    },
    async flow(known, sources, budget) {
      const res = await call<Extract<FlowResponse, { results: unknown }>>({ type: "flow", known, sources, budget });
      return res.results.map((r) => ({ ...r, vis: toBitSet(r.vis) }));
    },
  };
}

/** A {@link FlowRunner} on `pool`; `geometry` is for the single-threaded path, also used if the pool fails. */
export function createParallelFlowRunner<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): FlowRunner<D> {
  return poolRunner(pool, "portal flow", (graph) => graph.portals.length >= MIN_PARALLEL_PORTALS,
    (graph, mightSee, options) => computePortalFlow(geometry, graph, mightSee, options),
    async (calls, graph, mightSee, options) => {
      const result = await computePortalFlowParallel(graph, mightSee, calls.map(poolFlowWorker), options);
      // How much the dependency graph let run at once: compare with the thread count.
      console.debug(`portal flow: ${calls.length} threads, ready sources max ${result.parallel.maxReady}, mean ${result.parallel.meanReady.toFixed(1)}`);
      return result;
    });
}
