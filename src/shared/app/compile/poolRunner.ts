/**
 * The pattern every parallel stage runner shares: use the {@link WorkerPool} when the input is big
 * enough and the pool works, otherwise run the stage on this thread. A parallel failure also falls
 * back to this thread; only a dead worker ({@link PoolWorkerError}) disables the pool for later stages.
 */

import { type PoolCall, type WorkerPool, PoolWorkerError } from "./workerPool";

/**
 * Wraps a stage as a pool runner. `big(firstArg)`: worth going parallel; `single(...args)`: the
 * one-thread stage; `parallel(calls, ...args)`: the stage on the pool workers' calls.
 * `name`: for the fallback warning. The returned function takes the stage's arguments.
 */
export function poolRunner<A extends unknown[], R>(pool: WorkerPool, name: string, big: (input: NoInfer<A[0]>) => boolean, single: (...args: A) => R, parallel: (calls: PoolCall[], ...args: NoInfer<A>) => Promise<NoInfer<R>>): (...args: A) => Promise<R> {
  return async (...args) => {
    const calls = big(args[0]) ? pool.workers() : null;
    if (!calls) return single(...args);
    try {
      return await parallel(calls, ...args);
    } catch (e) {
      const dead = e instanceof PoolWorkerError;
      console.warn(`Parallel ${name} failed, using one thread${dead ? " from now on" : ""}`, e);
      if (dead) pool.markBroken();
      return single(...args);
    }
  };
}
