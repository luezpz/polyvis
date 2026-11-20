/**
 * The compile worker's pool of nested Web Workers (each running `servePool`),
 * shared by the parallel BSP build and portal flow so one set of threads
 * serves both stages. Workers are created on first use.
 */

/** Upper bound on pool threads. */
const MAX_THREADS = 16;

/**
 * A pool worker died or was terminated (as opposed to a stage throwing inside a live worker): the
 * only failure that should disable the pool, since a stage error would recur on any thread.
 */
export class PoolWorkerError extends Error {}

/** Sends one request (with a fresh `id`) to a pool worker and resolves with its response. */
export type PoolCall = <Res>(req: object) => Promise<Res>;

/**
 * Wraps one Web Worker as a {@link PoolCall}: responses are matched by `id`, `{ error }` rejects.
 * Pending and later calls reject once the worker fails or `kill` (terminate) is called.
 */
function workerCall(worker: Worker): { call: PoolCall; kill: () => void } {
  let nextId = 1;
  let dead: Error | null = null;
  const pending = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (!p) return;
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data as never);
  };
  // A failed or terminated worker never answers again: reject current and future calls instead of hanging.
  const fail = (err: Error): void => {
    dead ??= err;
    for (const p of pending.values()) p.reject(dead);
    pending.clear();
  };
  worker.onerror = (e) => fail(new PoolWorkerError(`pool worker failed: ${e.message}`));
  const call: PoolCall = <Res>(req: object) => new Promise<Res>((resolve, reject) => {
    if (dead) return reject(dead);
    const id = nextId++;
    pending.set(id, { resolve: resolve as (r: never) => void, reject });
    worker.postMessage({ ...req, id });
  });
  const kill = (): void => {
    worker.terminate();
    fail(new PoolWorkerError("pool worker terminated"));
  };
  return { call, kill };
}

export class WorkerPool {
  /** Threads the pool would use: cores − 1 (the compile worker), at most {@link MAX_THREADS}. */
  readonly threads = Math.max(1, Math.min(MAX_THREADS, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
  private calls: PoolCall[] | null = null;
  private kills: (() => void)[] = [];
  private broken = typeof Worker === "undefined";

  /** `createWorker`: makes one pool worker (a literal `new Worker(new URL(...))` in the caller, for Vite). */
  constructor(private readonly createWorker: () => Worker) {}

  /** One call per worker, or null if parallel stages should run single-threaded instead. */
  workers(): PoolCall[] | null {
    if (this.broken || this.threads < 2) return null;
    if (!this.calls) {
      try {
        this.calls = Array.from({ length: this.threads }, () => {
          const { call, kill } = workerCall(this.createWorker());
          this.kills.push(kill);
          return call;
        });
      } catch (e) {
        // `new Worker` can throw (no nested workers, CSP): drop the partial set, run single-threaded from now on.
        console.warn("Pool workers unavailable, using one thread", e);
        this.markBroken();
        return null;
      }
    }
    return this.calls;
  }

  /**
   * Terminates the workers but keeps the pool enabled; the next {@link workers} call spawns fresh ones.
   * Used after a stage error so threads still busy with the failed stage don't delay later stages.
   */
  recycle(): void {
    for (const kill of this.kills) kill();
    this.kills = [];
    this.calls = null;
  }

  /** Disables the pool after a failure (e.g. no nested-worker support) and terminates its workers; stages fall back to one thread. */
  markBroken(): void {
    this.broken = true;
    this.recycle();
  }
}
