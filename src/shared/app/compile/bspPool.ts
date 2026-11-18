/**
 * The parallel BSP build on the shared {@link WorkerPool}. Small levels and
 * environments without nested workers use the single-threaded build.
 */

import { type BspRunner, type BspWorker, type Dim, type Geometry, type PackedSubtree, type SplitChoice, buildBsp, buildBspParallel } from "../../core";
import { poolRunner } from "./poolRunner";
import type { PoolCall, WorkerPool } from "./workerPool";

/** Below this many walls, worker round trips and cloning cost more than they save. */
const MIN_PARALLEL_WALLS = 300;
/** More BSP threads were slower in measurements (Node threads, 4k walls: 4 threads 1.5x, 8 threads 1.2x): setup and the top walk are serial. */
const MAX_BSP_THREADS = 4;

/** One pool worker as a {@link BspWorker}. */
function poolBspWorker<D extends Dim>(call: PoolCall): BspWorker<D> {
  return {
    async begin(walls, opts) { await call({ type: "bsp-begin", walls, opts }); },
    async score(source, candidates) { return (await call<{ choice: SplitChoice }>({ type: "bsp-score", source, candidates })).choice; },
    async subtree(task) { return (await call<{ subtree: PackedSubtree<D> }>({ type: "bsp-subtree", task })).subtree; },
  };
}

/** A {@link BspRunner} on `pool`; `geometry` is for the single-threaded path, also used if the pool fails. */
export function createParallelBspRunner<D extends Dim>(geometry: Geometry<D>, pool: WorkerPool): BspRunner<D> {
  return poolRunner(pool, "BSP build", (walls) => walls.length >= MIN_PARALLEL_WALLS,
    (walls, options) => buildBsp(geometry, walls, options),
    (calls, walls, options) => buildBspParallel(geometry, walls, options, calls.slice(0, MAX_BSP_THREADS).map((c) => poolBspWorker<D>(c))));
}
