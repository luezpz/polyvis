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
 * Minimum ordered portal pairs (n²) per thread. Since the flat pair test (phase 6a) a pair costs
 * ~12 ns (bench: 2D Maze 16×16, 2.2 M pairs in 26 ms), so 2 M pairs is ~25 ms per thread, enough to
 * beat setup and messaging. At 250 k (the pre-6a value) threads never helped and sometimes hurt
 * (2D Oblique lattice 11 → 19 ms with 4 threads, 2D Maze 26 → 36 ms with 8; 2026-11-20).
 */
export const MIN_PAIRS_PER_THREAD = 2_000_000;

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
