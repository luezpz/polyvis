/**
 * Bench thread body (`--threads`): builds base vis and passage table rows for the main bench
 * thread, like the editors' pool workers (`shared/app/compile/servePool.ts`), with the same row
 * protocol plus `dim` (2 or 3) on `rows-begin`.
 */

import { geometry2 } from "../src/d2/core/geometry";
import { geometry3 } from "../src/d3/core/geometry";
import { type Dim, type Geometry, type RowJob, createRowSession } from "../src/shared/core";

export type BenchRequest =
  | { readonly id: number; readonly type: "rows-begin"; readonly dim: 2 | 3; readonly job: RowJob; readonly graph: Float64Array; readonly mightSee: Uint32Array | null }
  | { readonly id: number; readonly type: "rows"; readonly p0: number; readonly p1: number };

let rows: ((p0: number, p1: number) => Uint32Array) | null = null;

/** Answers one request: `{ id }` for begin, `{ id, words }` for rows. */
export function handle(req: BenchRequest): { id: number; words?: Uint32Array } {
  if (req.type === "rows-begin") {
    const g = (req.dim === 2 ? geometry2 : geometry3) as unknown as Geometry<Dim>;
    rows = createRowSession(g, req.job, req.graph, req.mightSee);
    return { id: req.id };
  }
  if (!rows) throw new Error("rows before begin");
  return { id: req.id, words: rows(req.p0, req.p1) };
}
