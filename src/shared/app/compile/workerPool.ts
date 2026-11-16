/**
 * The compile worker's pool of nested Web Workers (each running `servePool`),
 * shared by the parallel BSP build and portal flow so one set of threads
 * serves both stages. Workers are created on first use.
 */

/** Upper bound on pool threads. */
const MAX_THREADS = 16;

/** Sends one request (with a fresh `id`) to a pool worker and resolves with its response. */
export type PoolCall = <Res>(req: object) => Promise<Res>;

/** Wraps one Web Worker as a {@link PoolCall}: responses are matched by `id`, `{ error }` rejects. Rejects pending calls if the worker fails. */
function workerCall(worker: Worker): PoolCall {
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    if (!p) return;
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data as never);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`pool worker failed: ${e.message}`));
    pending.clear();
  };
  return <Res>(req: object) => new Promise<Res>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (r: never) => void, reject });
    worker.postMessage({ ...req, id });
  });
}

export class WorkerPool {
  /** Threads the pool would use: cores − 1 (the compile worker), at most {@link MAX_THREADS}. */
  readonly threads = Math.max(1, Math.min(MAX_THREADS, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
  private calls: PoolCall[] | null = null;
  private broken = typeof Worker === "undefined";

  /** `createWorker`: makes one pool worker (a literal `new Worker(new URL(...))` in the caller, for Vite). */
  constructor(private readonly createWorker: () => Worker) {}

  /** One call per worker, or null if parallel stages should run single-threaded instead. */
  workers(): PoolCall[] | null {
    if (this.broken || this.threads < 2) return null;
    this.calls ??= Array.from({ length: this.threads }, () => workerCall(this.createWorker()));
    return this.calls;
  }

  /** Disables the pool after a failure (e.g. no nested-worker support); stages fall back to one thread. */
  markBroken(): void {
    this.broken = true;
  }
}
