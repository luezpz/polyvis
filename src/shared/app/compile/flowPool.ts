/**
 * A pool of Web Workers running the portal flow in parallel, used from inside
 * the compile worker (nested workers). Small graphs and environments without
 * nested workers use the single-threaded flow instead.
 */

import { type Dim, type FlowRunner, type FlowWorker, type Geometry, computePortalFlow, computePortalFlowParallel } from "../../core";
import { type FlowRequest, type FlowResponse, toBitSet } from "./flowProtocol";

/** Below this many portals, worker start-up and cloning cost more than they save. */
const MIN_PARALLEL_PORTALS = 200;

/** Upper bound on flow threads. */
const MAX_THREADS = 16;

/** Wraps one Web Worker running `serveFlow` as a {@link FlowWorker}. Rejects pending calls if the worker fails. */
function workerFlowWorker(worker: Worker): FlowWorker {
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: FlowResponse) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<FlowResponse>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (!p) return;
    if ("error" in e.data) p.reject(new Error(e.data.error));
    else p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`flow worker failed: ${e.message}`));
    pending.clear();
  };
  const call = (req: FlowRequest): Promise<FlowResponse> => new Promise((resolve, reject) => {
    pending.set(req.id, { resolve, reject });
    worker.postMessage(req);
  });
  return {
    async begin(graph, mightSee, clipSource, rank) {
      await call({ type: "begin", id: nextId++, graph: graph as never, mightSee, clipSource, rank });
    },
    async flow(known, sources, budget) {
      const res = await call({ type: "flow", id: nextId++, known, sources, budget });
      if ("error" in res) throw new Error(res.error);
      return res.results.map((r) => ({ ...r, vis: toBitSet(r.vis) }));
    },
  };
}

/**
 * A {@link FlowRunner} backed by a lazily created worker pool.
 * `createWorker`: makes one flow worker (a literal `new Worker(new URL(...))` in the caller, for Vite).
 * `geometry`: for the single-threaded path. Falls back to it for small graphs or if the pool fails.
 */
export function createParallelFlowRunner<D extends Dim>(geometry: Geometry<D>, createWorker: () => Worker): FlowRunner<D> {
  let pool: FlowWorker[] | null = null;
  let broken = typeof Worker === "undefined";
  const threads = Math.max(1, Math.min(MAX_THREADS, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));

  return async (graph, mightSee, options) => {
    if (broken || threads < 2 || graph.portals.length < MIN_PARALLEL_PORTALS) return computePortalFlow(geometry, graph, mightSee, options);
    try {
      pool ??= Array.from({ length: threads }, () => workerFlowWorker(createWorker()));
      const result = await computePortalFlowParallel(graph, mightSee, pool, options);
      // How much the dependency graph let run at once: compare with the thread count.
      console.debug(`portal flow: ${threads} threads, ready sources max ${result.parallel.maxReady}, mean ${result.parallel.meanReady.toFixed(1)}`);
      return result;
    } catch (e) {
      console.warn("Parallel portal flow failed, using one thread", e);
      broken = true;
      return computePortalFlow(geometry, graph, mightSee, options);
    }
  };
}
