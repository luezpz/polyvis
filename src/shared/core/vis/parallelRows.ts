/**
 * Shared machinery of the "independent rows" parallel stages: base vis and the passage table.
 * In both, the rows of portal p depend only on the (packed) inputs, so portal ranges are built
 * on workers and copied into one array, equal bit for bit to the single-threaded build.
 *
 * One worker protocol serves both ({@link RowWorker}): `begin` names the job and ships packed
 * inputs (an object-graph clone cost ~10 ms per worker, serialized on the sending thread), then
 * `rows(p0, p1)` returns packed rows. Workers are abstract so this stays a pure library: the app
 * backs them with Web Workers, tests with {@link inProcessRowWorker}.
 */

import type { Dim, Geometry } from "../geometry";
import { workerQueue } from "../parallel";
import { unpackPortalGraph } from "../portals";
import { createBaseVisRows } from "./baseVis";
import { BitSet } from "./bitset";
import { createPassageRows, passageSlots } from "./passages";

/** Which row builder a session runs: base vis rows, or passage table (canSee) rows. */
export type RowJob = "basevis" | "passages";

/** One row-building thread. */
export interface RowWorker {
  /**
   * Starts a job (forgets earlier ones). `graph`: `packPortalGraph`; `mightSee`: base vis rows
   * (`BitSet.packRows`), for `"passages"` only. Implementations call {@link createRowSession}.
   */
  begin(job: RowJob, graph: Float64Array, mightSee: Uint32Array | null): Promise<void>;
  /** Packed rows of portals `[p0, p1)` (fresh array the worker never reads again). */
  rows(p0: number, p1: number): Promise<Uint32Array>;
}

/** Worker side of {@link RowWorker.begin}: unpacks the inputs and returns the row builder of `job`. */
export function createRowSession<D extends Dim>(geometry: Geometry<D>, job: RowJob, graph: Float64Array, mightSee: Uint32Array | null): (p0: number, p1: number) => Uint32Array {
  const gr = unpackPortalGraph(geometry, graph);
  if (job === "basevis") return createBaseVisRows(geometry, gr);
  if (!mightSee) throw new Error("passage rows need mightSee");
  return createPassageRows(geometry, gr, BitSet.unpackRows(gr.portals.length, mightSee), passageSlots(gr));
}

/** A {@link RowWorker} running on the calling thread (tests, and a fallback). */
export function inProcessRowWorker<D extends Dim>(geometry: Geometry<D>): RowWorker {
  let rows: ((p0: number, p1: number) => Uint32Array) | null = null;
  return {
    async begin(job, graph, mightSee) {
      rows = createRowSession(geometry, job, graph, mightSee);
    },
    async rows(p0, p1) {
      if (!rows) throw new Error("rows before begin");
      return rows(p0, p1);
    },
  };
}

/**
 * Begins `job` on every worker, then builds portal ranges `[start[c], start[c + 1])` on whichever
 * worker is idle and copies each into `out` at word `wordOffset(start[c])`.
 */
export async function buildRowsParallel(workers: readonly RowWorker[], job: RowJob, graph: Float64Array, mightSee: Uint32Array | null, start: readonly number[], out: Uint32Array, wordOffset: (p: number) => number): Promise<void> {
  await Promise.all(workers.map((w) => w.begin(job, graph, mightSee)));
  const run = workerQueue(workers);
  const jobs: Promise<void>[] = [];
  for (let c = 0; c + 1 < start.length; c++) {
    const p0 = start[c], p1 = start[c + 1];
    jobs.push(run((w) => w.rows(p0, p1)).then((words) => out.set(words, wordOffset(p0))));
  }
  await Promise.all(jobs);
}
