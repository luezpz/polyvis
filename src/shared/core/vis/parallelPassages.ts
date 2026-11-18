/**
 * Parallel passage table build (phase 2a/2b). Rows of different portals are independent
 * (`createPassageRows`), so portal ranges are built on workers and copied into one table:
 * the result equals {@link computePassages} bit for bit.
 *
 * Load balance: the cost of portal p is about out-degree(p.to) × |mightSee[p]| clips, very uneven
 * across a level, so the range is cut into ~{@link CHUNKS_PER_WORKER} chunks per worker of equal
 * estimated cost and handed out as workers become idle. Each extra thread costs a few ms (clone,
 * unpack, sphere setup), so the thread count follows the estimated cost
 * ({@link MIN_COST_PER_THREAD}); one thread means a local build, no workers at all.
 *
 * Inputs go to workers packed (`packPortalGraph`, `BitSet.packRows`): an object-graph clone cost
 * ~10 ms per worker, serialized on the sending thread, which ate the whole gain on small tables.
 *
 * Workers are abstract ({@link PassageWorker}) so this stays a pure library: the app backs them
 * with Web Workers, tests with {@link inProcessPassageWorker}.
 */

import type { Dim, Geometry } from "../geometry";
import { type PortalGraph, packPortalGraph, unpackPortalGraph } from "../portals";
import { BitSet } from "./bitset";
import { type PassageTable, computePassages, createPassageRows, passageSlots } from "./passages";

/** One passage-build thread. */
export interface PassageWorker {
  /**
   * Starts a build (forgets earlier ones). `graph`: `packPortalGraph`; `mightSee`: base vis rows,
   * `BitSet.packRows`. Implementations rebuild them with {@link createPassageSession}.
   */
  begin(graph: Float64Array, mightSee: Uint32Array): Promise<void>;
  /** canSee rows of portals `[p0, p1)`, as `createPassageRows` returns them. */
  rows(p0: number, p1: number): Promise<Uint32Array>;
}

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

/** Worker side of {@link PassageWorker.begin}: unpacks the inputs and returns the row builder. */
export function createPassageSession<D extends Dim>(geometry: Geometry<D>, graph: Float64Array, mightSee: Uint32Array): (p0: number, p1: number) => Uint32Array {
  const gr = unpackPortalGraph(geometry, graph);
  return createPassageRows(geometry, gr, BitSet.unpackRows(gr.portals.length, mightSee), passageSlots(gr));
}

/** A {@link PassageWorker} running on the calling thread (tests, and a fallback). */
export function inProcessPassageWorker<D extends Dim>(geometry: Geometry<D>): PassageWorker {
  let rows: ((p0: number, p1: number) => Uint32Array) | null = null;
  return {
    async begin(graph, mightSee) {
      rows = createPassageSession(geometry, graph, mightSee);
    },
    async rows(p0, p1) {
      if (!rows) throw new Error("rows before begin");
      return rows(p0, p1);
    },
  };
}

/** Portal ranges `[start[i], start[i + 1])` of about equal total `cost` (`count` ranges at most, none empty). */
export function passageChunks(cost: Float64Array, count: number): number[] {
  const n = cost.length;
  let total = 0;
  for (let p = 0; p < n; p++) total += cost[p];
  const start = [0];
  let acc = 0;
  for (let p = 0; p < n; p++) {
    acc += cost[p];
    if (acc >= (total * start.length) / count && p + 1 < n) start.push(p + 1);
  }
  start.push(n);
  return start;
}

/**
 * {@link computePassages} spread over up to `workers.length` workers (at least one). Same table.
 * `minCostPerThread`: see {@link MIN_COST_PER_THREAD}; 0 uses every worker (tests).
 */
export async function computePassagesParallel<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], allWorkers: readonly PassageWorker[], minCostPerThread = MIN_COST_PER_THREAD): Promise<PassageTable> {
  if (allWorkers.length === 0) throw new Error("computePassagesParallel needs at least one worker");
  const cost = passageCosts(geometry, graph, mightSee);
  const total = cost.reduce((s, c) => s + c, 0);
  const threads = minCostPerThread > 0 ? Math.min(allWorkers.length, Math.floor(total / minCostPerThread)) : allWorkers.length;
  if (threads <= 1 && minCostPerThread > 0) return computePassages(geometry, graph, mightSee);
  const workers = allWorkers.slice(0, threads);
  const n = graph.portals.length, wordsPerRow = (n + 31) >>> 5;
  const slot = passageSlots(graph);
  const words = new Uint32Array(slot[n] * wordsPerRow);
  const start = passageChunks(cost, workers.length * CHUNKS_PER_WORKER);
  const packedGraph = packPortalGraph(geometry, graph), packedRows = BitSet.packRows(mightSee);
  await Promise.all(workers.map((w) => w.begin(packedGraph, packedRows)));

  // Each worker loops: take the next chunk, build it, copy it in place.
  let next = 0;
  await Promise.all(workers.map(async (w) => {
    while (next < start.length - 1) {
      const c = next++;
      const p0 = start[c], p1 = start[c + 1];
      words.set(await w.rows(p0, p1), slot[p0] * wordsPerRow);
    }
  }));
  return { slot, wordsPerRow, words };
}
