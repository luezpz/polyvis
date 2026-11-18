/**
 * The pattern every parallel stage runner shares: use the {@link WorkerPool} when the input is big
 * enough and the pool works, otherwise (or after a failure, which disables the pool) run the
 * stage on this thread.
 */

import type { PoolCall, WorkerPool } from "./workerPool";

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
      console.warn(`Parallel ${name} failed, using one thread`, e);
      pool.markBroken();
      return single(...args);
    }
  };
}
