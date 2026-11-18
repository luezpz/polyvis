/**
 * Parallel base vis. Rows of different portals are independent (`createBaseVisRows`): each is n
 * pair tests plus a flood, so portal ranges are built on workers and copied into one array; the
 * result equals {@link computeBaseVis} bit for bit.
 *
 * Cost per row is about the same (n pair tests), so ranges are equal-sized; ~{@link CHUNKS_PER_WORKER}
 * per worker, handed out as workers become idle, even out flood and sphere-fallback differences.
 * Inputs go packed (`packPortalGraph`), as for the passage table. Workers are abstract
 * ({@link BaseVisWorker}) so this stays a pure library: the app backs them with Web Workers,
 * tests with {@link inProcessBaseVisWorker}.
 */

import type { Dim, Geometry } from "../geometry";
import { type PortalGraph, packPortalGraph, unpackPortalGraph } from "../portals";
import { baseVisFromWords, computeBaseVis, createBaseVisRows } from "./baseVis";
import type { BitSet } from "./bitset";

/** One base-vis thread. */
export interface BaseVisWorker {
  /** Starts a build (forgets earlier ones). `graph`: `packPortalGraph`; rebuilt with {@link createBaseVisSession}. */
  begin(graph: Float64Array): Promise<void>;
  /** Packed mightSee rows of portals `[p0, p1)`, as `createBaseVisRows` returns them. */
  rows(p0: number, p1: number): Promise<Uint32Array>;
}

/** Chunks per worker: enough to even out uneven chunks, few enough to keep round trips cheap. */
const CHUNKS_PER_WORKER = 8;

/**
 * Minimum ordered portal pairs (n²) per thread. A pair test costs ~70–350 ns (sphere test,
 * sometimes `classifyFacet`; bench), so this is ~20–90 ms of work, well above per-thread setup
 * (graph clone + unpack + spheres, a few ms). Was 2 M: 3D Grid city (3.5 M pairs) got one thread.
 */
export const MIN_PAIRS_PER_THREAD = 250_000;

/** Worker side of {@link BaseVisWorker.begin}: unpacks the graph and returns the row builder. */
export function createBaseVisSession<D extends Dim>(geometry: Geometry<D>, graph: Float64Array): (p0: number, p1: number) => Uint32Array {
  return createBaseVisRows(geometry, unpackPortalGraph(geometry, graph));
}

/** A {@link BaseVisWorker} running on the calling thread (tests, and a fallback). */
export function inProcessBaseVisWorker<D extends Dim>(geometry: Geometry<D>): BaseVisWorker {
  let rows: ((p0: number, p1: number) => Uint32Array) | null = null;
  return {
    async begin(graph) {
      rows = createBaseVisSession(geometry, graph);
    },
    async rows(p0, p1) {
      if (!rows) throw new Error("rows before begin");
      return rows(p0, p1);
    },
  };
}

/**
 * {@link computeBaseVis} spread over up to `workers.length` workers (at least one). Same rows.
 * `minPairsPerThread`: see {@link MIN_PAIRS_PER_THREAD}; 0 uses every worker (tests).
 */
export async function computeBaseVisParallel<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, allWorkers: readonly BaseVisWorker[], minPairsPerThread = MIN_PAIRS_PER_THREAD): Promise<BitSet[]> {
  if (allWorkers.length === 0) throw new Error("computeBaseVisParallel needs at least one worker");
  const n = graph.portals.length;
  const threads = minPairsPerThread > 0 ? Math.min(allWorkers.length, Math.floor((n * n) / minPairsPerThread)) : allWorkers.length;
  if ((threads <= 1 && minPairsPerThread > 0) || n === 0) return computeBaseVis(geometry, graph);
  const workers = allWorkers.slice(0, threads);
  const wordsPerRow = (n + 31) >>> 5;
  const words = new Uint32Array(n * wordsPerRow);
  const chunks = Math.min(n, workers.length * CHUNKS_PER_WORKER);
  const start = Array.from({ length: chunks + 1 }, (_, c) => Math.round((c * n) / chunks));
  const packedGraph = packPortalGraph(geometry, graph);
  await Promise.all(workers.map((w) => w.begin(packedGraph)));

  // Each worker loops: take the next chunk, build it, copy it in place.
  let next = 0;
  await Promise.all(workers.map(async (w) => {
    while (next < chunks) {
      const c = next++;
      words.set(await w.rows(start[c], start[c + 1]), start[c] * wordsPerRow);
    }
  }));
  return baseVisFromWords(n, words);
}
