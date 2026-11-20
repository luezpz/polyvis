/**
 * Runs compilations in a Web Worker, at most one at a time: while one is in
 * flight, newer requests replace each other and only the latest is sent when
 * the worker becomes free (so dragging a brush never queues up stale work).
 * Falls back to compiling on the main thread if workers are unavailable.
 */

import type { CompileOptions, CompileResult, Dim } from "../../core";
import { type CompileRequest, type CompileResponse, hydrateResult } from "./protocol";

/** Receives each finished compilation: a result or an error message, and the compile time in ms. */
export type CompileListener<D extends Dim> = (result: CompileResult<D> | null, error: string | null, ms: number) => void;

/** How a dimension compiles: its worker (a module calling `serveCompiler`) and the same compiler for the main-thread fallback. */
export interface CompilerBinding<D extends Dim, L> {
  /** Creates the worker; must use `new Worker(new URL("./x.ts", import.meta.url))` in the caller's module for Vite. */
  readonly createWorker: () => Worker;
  readonly compile: (level: L, options: Partial<CompileOptions>) => CompileResult<D>;
}

export class CompileClient<D extends Dim, L> {
  private worker: Worker | null = null;
  private inFlight: number | null = null;
  private pending: { level: L; options: Partial<CompileOptions> } | null = null;
  /** The job the worker is running, so a worker crash can re-run it on the main thread. */
  private running: { level: L; options: Partial<CompileOptions> } | null = null;
  private nextId = 1;

  constructor(private readonly binding: CompilerBinding<D, L>, private readonly listener: CompileListener<D>) {
    try {
      this.worker = binding.createWorker();
      this.worker.onmessage = (e: MessageEvent<CompileResponse<D>>) => this.onResponse(e.data);
      this.worker.onerror = (e) => {
        console.error("Compile worker failed, falling back to the main thread", e);
        this.worker?.terminate();
        this.worker = null;
        this.inFlight = null;
        // Re-run the lost job unless a newer request already supersedes it.
        this.pending ??= this.running;
        this.running = null;
        this.flush();
      };
    } catch (e) {
      console.warn("Web Workers unavailable, compiling on the main thread", e);
      this.worker = null;
    }
  }

  /** True while a compilation is running or queued. */
  get busy(): boolean {
    return this.inFlight !== null || this.pending !== null;
  }

  /** Queues a compile of `level`, replacing any queued (not yet started) one. */
  request(level: L, options: Partial<CompileOptions>): void {
    this.pending = { level, options };
    if (this.inFlight === null) this.flush();
  }

  private flush(): void {
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    if (!this.worker) {
      // Main-thread fallback (deferred so input handlers return first).
      this.inFlight = -1;
      setTimeout(() => {
        const t0 = performance.now();
        try {
          const result = this.binding.compile(job.level, job.options);
          this.inFlight = null;
          this.listener(result, null, performance.now() - t0);
        } catch (e) {
          this.inFlight = null;
          this.listener(null, (e as Error).message, performance.now() - t0);
        }
        this.flush();
      }, 0);
      return;
    }
    const id = this.nextId++;
    this.inFlight = id;
    this.running = job;
    const msg: CompileRequest<L> = { id, level: job.level, options: job.options };
    this.worker.postMessage(msg);
  }

  private onResponse(res: CompileResponse<D>): void {
    if (res.id !== this.inFlight) return;
    this.inFlight = null;
    this.running = null;
    // Deliver even if newer work is pending: a slightly stale result beats a blank view.
    if ("error" in res) this.listener(null, res.error, 0);
    else this.listener(hydrateResult(res.result), null, res.ms);
    this.flush();
  }
}
