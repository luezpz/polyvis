/**
 * Bench thread body (`--threads`): builds base vis and passage table rows for the main bench thread, like the
 * editors' pool workers (`shared/app/compile/servePool.ts`). Messages carry `dim` (2 or 3).
 */

import { geometry2 } from "../src/d2/core/geometry";
import { geometry3 } from "../src/d3/core/geometry";
import { type Dim, type Geometry, createPassageSession, createBaseVisSession } from "../src/shared/core";

export type BenchRequest =
  | { readonly id: number; readonly type: "passage-begin"; readonly dim: 2 | 3; readonly graph: Float64Array; readonly mightSee: Uint32Array }
  | { readonly id: number; readonly type: "passage-rows"; readonly p0: number; readonly p1: number }
  | { readonly id: number; readonly type: "basevis-begin"; readonly dim: 2 | 3; readonly graph: Float64Array }
  | { readonly id: number; readonly type: "basevis-rows"; readonly p0: number; readonly p1: number };

let rows: ((p0: number, p1: number) => Uint32Array) | null = null;
let baseRows: ((p0: number, p1: number) => Uint32Array) | null = null;

/** Answers one request: `{ id }` for begin, `{ id, words }` for rows. */
export function handle(req: BenchRequest): { id: number; words?: Uint32Array } {
  const geometryOf = (dim: 2 | 3) => (dim === 2 ? geometry2 : geometry3) as unknown as Geometry<Dim>;
  if (req.type === "basevis-begin") {
    baseRows = createBaseVisSession(geometryOf(req.dim), req.graph);
    return { id: req.id };
  }
  if (req.type === "basevis-rows") {
    if (!baseRows) throw new Error("base vis rows before begin");
    return { id: req.id, words: baseRows(req.p0, req.p1) };
  }
  if (req.type === "passage-begin") {
    const g = geometryOf(req.dim);
    rows = createPassageSession(g, req.graph, req.mightSee);
    return { id: req.id };
  }
  if (!rows) throw new Error("rows before begin");
  return { id: req.id, words: rows(req.p0, req.p1) };
}
