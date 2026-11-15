/**
 * Runs compilations in a Web Worker, at most one at a time: while one is in
 * flight, newer requests replace each other and only the latest is sent when
 * the worker becomes free (so dragging a brush never queues up stale work).
 * Falls back to compiling on the main thread if workers are unavailable.
 */

import { type CompileOptions, type CompileResult, type Level, compileLevel } from "../../core";
import { type CompileRequest, type CompileResponse, hydrateResult } from "./protocol";

export type CompileListener = (result: CompileResult | null, error: string | null, ms: number) => void;

export class CompileClient {
  private worker: Worker | null = null;
  private inFlight: number | null = null;
  private pending: { level: Level; options: Partial<CompileOptions> } | null = null;
  private nextId = 1;

  constructor(private readonly listener: CompileListener) {
    try {
      this.worker = new Worker(new URL("./compileWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<CompileResponse>) => this.onResponse(e.data);
      this.worker.onerror = (e) => {
        console.error("Compile worker failed, falling back to the main thread", e);
        this.worker?.terminate();
        this.worker = null;
        this.inFlight = null;
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

  request(level: Level, options: Partial<CompileOptions>): void {
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
          const result = compileLevel(job.level, job.options);
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
    const msg: CompileRequest = { id, level: job.level, options: job.options };
    this.worker.postMessage(msg);
  }

  private onResponse(res: CompileResponse): void {
    if (res.id !== this.inFlight) return;
    this.inFlight = null;
    // Deliver even if newer work is pending: a slightly stale result beats a blank view.
    if ("error" in res) this.listener(null, res.error, 0);
    else this.listener(hydrateResult(res.result), null, res.ms);
    this.flush();
  }
}
