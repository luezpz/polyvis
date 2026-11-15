/** Shared app infrastructure (DOM-free parts): history, view-state snapping, compile protocol and client fallback. */

import { describe, expect, it } from "vitest";
import { History } from "../../src/shared/app/editor/history";
import { hydrateResult } from "../../src/shared/app/compile/protocol";
import { CompileClient } from "../../src/shared/app/compile/compileClient";
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
