/**
 * Parallel base vis on {@link RowWorker}s (`parallelRows.ts`): each row is n pair tests plus a
 * flood, about the same cost, so ranges are equal-sized; ~{@link CHUNKS_PER_WORKER} per worker,
 * handed out as workers become idle, even out flood and sphere-fallback differences.
 * Equals {@link computeBaseVis} bit for bit.
 */

import type { Dim, Geometry } from "../geometry";
import { costChunks, threadsFor } from "../parallel";
import { type PortalGraph, packPortalGraph } from "../portals";
import { baseVisFromWords, computeBaseVis } from "./baseVis";
import type { BitSet } from "./bitset";
import { type RowWorker, buildRowsParallel } from "./parallelRows";

/** Chunks per worker: enough to even out uneven chunks, few enough to keep round trips cheap. */
const CHUNKS_PER_WORKER = 8;

/**
 * Minimum ordered portal pairs (n²) per thread. A pair test costs ~70–350 ns (sphere test,
 * sometimes `classifyFacet`; bench), so this is ~20–90 ms of work, well above per-thread setup
 * (graph clone + unpack + spheres, a few ms). Was 2 M: 3D Grid city (3.5 M pairs) got one thread.
 */
export const MIN_PAIRS_PER_THREAD = 250_000;

/**
 * {@link computeBaseVis} spread over up to `workers.length` workers (at least one). Same rows.
 * `minPairsPerThread`: see {@link MIN_PAIRS_PER_THREAD}; 0 uses every worker (tests).
 */
export async function computeBaseVisParallel<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, allWorkers: readonly RowWorker[], minPairsPerThread = MIN_PAIRS_PER_THREAD): Promise<BitSet[]> {
  if (allWorkers.length === 0) throw new Error("computeBaseVisParallel needs at least one worker");
  const n = graph.portals.length;
  const threads = threadsFor(n * n, allWorkers.length, minPairsPerThread);
  if ((threads <= 1 && minPairsPerThread > 0) || n === 0) return computeBaseVis(geometry, graph);
  const wordsPerRow = (n + 31) >>> 5;
  const words = new Uint32Array(n * wordsPerRow);
  const start = costChunks(new Float64Array(n).fill(1), threads * CHUNKS_PER_WORKER);
  await buildRowsParallel(allWorkers.slice(0, threads), "basevis", packPortalGraph(geometry, graph), null, start, words, (p) => p * wordsPerRow);
  return baseVisFromWords(n, words);
}
