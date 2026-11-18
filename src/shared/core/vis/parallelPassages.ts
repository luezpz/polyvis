/**
 * Parallel passage table build (phase 2a/2b) on {@link RowWorker}s (`parallelRows.ts`): the
 * result equals {@link computePassages} bit for bit.
 *
 * Load balance: the cost of portal p is about out-degree(p.to) × |mightSee[p]| clips, very uneven
 * across a level, so the range is cut into ~{@link CHUNKS_PER_WORKER} chunks per worker of equal
 * estimated cost and handed out as workers become idle. Each extra thread costs a few ms (clone,
 * unpack, sphere setup), so the thread count follows the estimated cost
 * ({@link MIN_COST_PER_THREAD}); one thread means a local build, no workers at all.
 */

import type { Dim, Geometry } from "../geometry";
import { costChunks, threadsFor } from "../parallel";
import { type PortalGraph, packPortalGraph } from "../portals";
import { BitSet } from "./bitset";
import { type RowWorker, buildRowsParallel } from "./parallelRows";
import { type PassageTable, computePassages, passageSlots } from "./passages";

/** Chunks per worker: enough to even out uneven chunks, few enough to keep round trips cheap. */
const CHUNKS_PER_WORKER = 8;

/**
 * Estimated cost units (2D-equivalent, see {@link passageCosts}) one thread must get to pay for its
 * setup: ~20 ms. Measured (Node, single thread): ~45–100 ns per unit in 2D, ~125–340 ns in 3D,
 * hence the 3D weight of 3; per-thread setup ~2–10 ms (warm), more for big graphs.
 */
export const MIN_COST_PER_THREAD = 400_000;

/**
 * Estimated build cost of each portal's rows: (out-degree + 1) × (|mightSee[p]| + 1), × 3 in 3D
 * (more clipping work per separator). Empty rows still count a little.
 */
export function passageCosts<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[]): Float64Array {
  const n = graph.portals.length, weight = geometry.dimension === 3 ? 3 : 1;
  const cost = new Float64Array(n);
  for (let p = 0; p < n; p++) cost[p] = weight * (graph.portalsFrom[graph.portals[p].to].length + 1) * (mightSee[p].count() + 1);
  return cost;
}

/**
 * {@link computePassages} spread over up to `workers.length` workers (at least one). Same table.
 * `minCostPerThread`: see {@link MIN_COST_PER_THREAD}; 0 uses every worker (tests).
 */
export async function computePassagesParallel<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], allWorkers: readonly RowWorker[], minCostPerThread = MIN_COST_PER_THREAD): Promise<PassageTable> {
  if (allWorkers.length === 0) throw new Error("computePassagesParallel needs at least one worker");
  const cost = passageCosts(geometry, graph, mightSee);
  const threads = threadsFor(cost.reduce((s, c) => s + c, 0), allWorkers.length, minCostPerThread);
  if (threads <= 1 && minCostPerThread > 0) return computePassages(geometry, graph, mightSee);
  const n = graph.portals.length, wordsPerRow = (n + 31) >>> 5;
  const slot = passageSlots(graph);
  const words = new Uint32Array(slot[n] * wordsPerRow);
  const start = costChunks(cost, threads * CHUNKS_PER_WORKER);
  await buildRowsParallel(allWorkers.slice(0, threads), "passages", packPortalGraph(geometry, graph), BitSet.packRows(mightSee), start, words, (p) => slot[p] * wordsPerRow);
  return { slot, wordsPerRow, words };
}
