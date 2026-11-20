/** Shared app infrastructure (DOM-free parts): history, view-state snapping, compile protocol and client fallback. */

import { describe, expect, it, vi } from "vitest";
import { History } from "../../src/shared/app/editor/history";
import { hydrateResult } from "../../src/shared/app/compile/protocol";
import { CompileClient } from "../../src/shared/app/compile/compileClient";
import { WorkerPool, PoolWorkerError } from "../../src/shared/app/compile/workerPool";
import { poolRunner } from "../../src/shared/app/compile/poolRunner";
import { BitSet } from "../../src/shared/core";
import { SAMPLE_LEVELS as SAMPLES_2D, compileLevel as compile2, type Level as Level2 } from "../../src/d2/core";
import { SAMPLE_LEVELS as SAMPLES_3D, compileLevel as compile3 } from "../../src/d3/core";
import type { Dim2 } from "../../src/d2/core/geometry";
import { ViewState as ViewState2 } from "../../src/d2/app/editor/viewState";
import { ViewState as ViewState3 } from "../../src/d3/app/editor/viewState";

describe("History", () => {
  it("undoes and redoes snapshots in order", () => {
    const h = new History<number>();
    h.record(1);
    h.record(2);
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.canUndo).toBe(false);
    expect(h.redo(1)).toBe(2);
    expect(h.canRedo).toBe(true);
  });
});

describe("BaseViewState", () => {
  it("snaps every coordinate in both dimensions, or none when off", () => {
    const v2 = new ViewState2();
    v2.gridSize = 0.5;
    expect(v2.snapPoint({ x: 0.3, y: -0.8 })).toEqual({ x: 0.5, y: -1 });
    const v3 = new ViewState3();
    expect(v3.snapPoint({ x: 1.4, y: 2.6, z: -0.4 })).toEqual({ x: 1, y: 3, z: -0 });
    v3.snap = false;
    expect(v3.snapPoint({ x: 1.4, y: 2.6, z: 0.4 })).toEqual({ x: 1.4, y: 2.6, z: 0.4 });
  });

  it("clearProbe keeps dimension-specific inspect fields", () => {
    const v3 = new ViewState3();
    v3.inspect = { point: { x: 1, y: 2, z: 3 }, pinned: true, portal: 4, fromCamera: true };
    v3.clearProbe();
    expect(v3.inspect).toEqual({ point: null, pinned: false, portal: null, fromCamera: true });
  });
});

describe("compile protocol", () => {
  it("hydrateResult restores BitSets after a structured clone (2D and 3D)", () => {
    const check = <R extends Parameters<typeof hydrateResult>[0]>(result: R): void => {
      const back = hydrateResult(structuredClone(result));
      for (const rows of [back.mightSee, back.portalVis, back.pvs, back.pvsTable.rows]) {
        for (const row of rows) expect(row).toBeInstanceOf(BitSet);
      }
      expect(back.pvs.map((r) => r.toArray())).toEqual(result.pvs.map((r) => r.toArray()));
    };
    check(compile2(SAMPLES_2D[0].create()));
    check(compile3(SAMPLES_3D[0].create()));
  });

  it("CompileClient falls back to the main thread and keeps only the latest request", async () => {
    const compiled: Level2[] = [];
    const results: number[] = [];
    const client = new CompileClient<Dim2, Level2>({
      createWorker: () => { throw new Error("no workers here"); },
      compile: (level, options) => { compiled.push(level); return compile2(level, options); },
    }, (result) => { if (result) results.push(result.pvs.length); });
    const a = SAMPLES_2D[0].create();
    const b = SAMPLES_2D[SAMPLES_2D.length - 1].create();
    client.request(a, {}); // starts at once (deferred)
    client.request(a, {}); // queued, then replaced
    client.request(b, {});
    expect(client.busy).toBe(true);
    while (client.busy) await new Promise((r) => setTimeout(r, 0));
    expect(compiled).toEqual([a, b]);
    expect(results).toHaveLength(2);
  });
});

/** Minimal stand-in for a Web Worker: records posts; the test fires `onerror` / `onmessage` by hand. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(m: unknown): void { this.posted.push(m); }
  terminate(): void { this.terminated = true; }
}

describe("worker failures", () => {
  it("CompileClient re-runs the in-flight job on the main thread when the worker crashes", async () => {
    const worker = new FakeWorker();
    const compiled: Level2[] = [];
    let results = 0;
    const client = new CompileClient<Dim2, Level2>({
      createWorker: () => worker as unknown as Worker,
      compile: (level, options) => { compiled.push(level); return compile2(level, options); },
    }, (result) => { if (result) results++; });
    const a = SAMPLES_2D[0].create();
    client.request(a, {});
    expect(worker.posted).toHaveLength(1);
    worker.onerror!({ message: "boom" } as ErrorEvent);
    expect(worker.terminated).toBe(true);
    while (client.busy) await new Promise((r) => setTimeout(r, 0));
    expect(compiled).toEqual([a]);
    expect(results).toBe(1);
  });

  it("poolRunner keeps the pool after a stage error, disables it only when a worker dies", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pool = new WorkerPool(() => new FakeWorker() as unknown as Worker);
      let err: Error = new Error("stage bug");
      const run = poolRunner(pool, "test", () => true, (x: number) => x + 1, () => Promise.reject(err));
      expect(await run(1)).toBe(2);
      expect(pool.workers()).not.toBeNull();
      err = new PoolWorkerError("pool worker failed");
      expect(await run(1)).toBe(2);
      expect(pool.workers()).toBeNull();
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("CompileClient abandons a slow stale compile for a newer request, but keeps a fresh one", () => {
    const made: FakeWorker[] = [];
    const client = new CompileClient<Dim2, Level2>({
      createWorker: () => { const w = new FakeWorker(); made.push(w); return w as unknown as Worker; },
      compile: compile2,
    }, () => {}, 1000);
    const a = SAMPLES_2D[0].create();
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      client.request(a, {});
      now.mockReturnValue(500);
      client.request(a, {}); // in flight for 0.5 s: queued
      expect(made).toHaveLength(1);
      now.mockReturnValue(2000);
      client.request(a, {}); // in flight for 2 s: abandoned
      expect(made[0].terminated).toBe(true);
      expect(made).toHaveLength(2);
      expect(made[1].posted).toHaveLength(1);
    } finally {
      now.mockRestore();
    }
  });

  it("CompileClient reports the worker's time for failed compiles", () => {
    const worker = new FakeWorker();
    const got: [string | null, number][] = [];
    const client = new CompileClient<Dim2, Level2>({ createWorker: () => worker as unknown as Worker, compile: compile2 }, (_r, e, ms) => got.push([e, ms]));
    client.request(SAMPLES_2D[0].create(), {});
    const { id } = worker.posted[0] as { id: number };
    worker.onmessage!({ data: { id, error: "bad level", ms: 12 } } as MessageEvent);
    expect(got).toEqual([["bad level", 12]]);
  });

  it("WorkerPool.markBroken terminates its workers and rejects their pending and later calls", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    try {
      const made: FakeWorker[] = [];
      const pool = new WorkerPool(() => { const w = new FakeWorker(); made.push(w); return w as unknown as Worker; });
      const calls = pool.workers()!;
      expect(calls).toHaveLength(3);
      const pending = calls[0]({ kind: "x" });
      pool.markBroken();
      await expect(pending).rejects.toThrow(/terminated/);
      await expect(calls[1]({ kind: "x" })).rejects.toThrow(/terminated/);
      expect(made.every((w) => w.terminated)).toBe(true);
      expect(pool.workers()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("WorkerPool falls back to one thread when a worker cannot be created, terminating the partial set", () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const made: FakeWorker[] = [];
      const pool = new WorkerPool(() => {
        if (made.length === 2) throw new Error("SecurityError");
        const w = new FakeWorker(); made.push(w); return w as unknown as Worker;
      });
      expect(pool.workers()).toBeNull();
      expect(made.every((w) => w.terminated)).toBe(true);
      expect(pool.workers()).toBeNull();
      expect(made).toHaveLength(2); // no retry on later stages
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("poolRunner recycles the workers after a stage error, so busy threads don't delay later stages", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const made: FakeWorker[] = [];
      const pool = new WorkerPool(() => { const w = new FakeWorker(); made.push(w); return w as unknown as Worker; });
      const run = poolRunner(pool, "test", () => true, (x: number) => x + 1, () => Promise.reject(new Error("stage bug")));
      expect(await run(1)).toBe(2);
      expect(made).toHaveLength(3);
      expect(made.every((w) => w.terminated)).toBe(true);
      expect(pool.workers()).toHaveLength(3); // fresh workers, pool still enabled
      expect(made.slice(3).some((w) => w.terminated)).toBe(false);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it("a crashed pool worker rejects later calls instead of hanging", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 3 });
    try {
      const made: FakeWorker[] = [];
      const calls = new WorkerPool(() => { const w = new FakeWorker(); made.push(w); return w as unknown as Worker; }).workers()!;
      made[0].onerror!({ message: "boom" } as ErrorEvent);
      await expect(calls[0]({ kind: "x" })).rejects.toThrow(/boom/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
