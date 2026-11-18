/**
 * Scheduling helpers shared by the parallel stages (BSP, base vis, passage table). Workers are
 * abstract (any object), so this stays a pure library.
 */

/**
 * Runs each job on the next idle worker, queueing jobs while all are busy (FIFO). Lets callers
 * submit all jobs at once and still hand work out as workers become free.
 */
export function workerQueue<W>(workers: readonly W[]): <T>(job: (w: W) => Promise<T>) => Promise<T> {
  const idle = [...workers];
  const waiting: ((w: W) => void)[] = [];
  return async (job) => {
    const w = idle.pop() ?? (await new Promise<W>((resolve) => waiting.push(resolve)));
    try {
      return await job(w);
    } finally {
      const next = waiting.shift();
      if (next) next(w);
      else idle.push(w);
    }
  };
}

/**
 * Splits items `[0, cost.length)` into ranges `[start[i], start[i + 1])` of about equal total
 * `cost` (`count` ranges at most, none empty; one range `[0, 0]` if there are no items).
 */
export function costChunks(cost: Float64Array, count: number): number[] {
  const n = cost.length;
  let total = 0;
  for (let p = 0; p < n; p++) total += cost[p];
  const start = [0];
  let acc = 0;
  for (let p = 0; p < n; p++) {
    acc += cost[p];
    if (acc >= (total * start.length) / count && p + 1 < n) start.push(p + 1);
  }
  start.push(n);
  return start;
}

/**
 * Thread count for `work` units when each thread must get at least `minWorkPerThread` to pay for
 * its setup, capped at `available`. `minWorkPerThread` 0 means use every thread (tests).
 */
export function threadsFor(work: number, available: number, minWorkPerThread: number): number {
  return minWorkPerThread > 0 ? Math.min(available, Math.floor(work / minWorkPerThread)) : available;
}
