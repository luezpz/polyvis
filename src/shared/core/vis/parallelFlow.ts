/**
 * Parallel portal flow with results identical to the single-threaded
 * {@link computePortalFlow}.
 *
 * Source i reads finished rows only for portals that pass `might.has(gid)`,
 * and `might ⊆ mightSee[i]`; single-threaded, only rows of sources earlier in
 * {@link portalFlowOrder} exist. So source i depends exactly on
 *
 *   deps(i) = { j ∈ mightSee[i] : rank(j) < rank(i) }
 *
 * and we start it as soon as all of deps(i) are finished, handing the worker
 * those rows. Workers may hold rows of later sources too; `flowFromSource`
 * ignores them via `rank`. Sources in distant, mutually invisible areas thus
 * run concurrently; in open levels deps form a near-chain and it degrades to
 * serial (still correct).
 *
 * Exactness holds unless `maxSteps` is hit: the budget is checked at dispatch,
 * so which sources fall back to base vis then depends on timing. Each in-flight
 * batch gets the whole remaining budget, so the run can overshoot `maxSteps` by
 * up to (workers − 1) × the remaining budget at dispatch; it is a safety valve,
 * not an exact cap (splitting it would truncate sources a serial run finishes).
 *
 * Workers are abstract ({@link FlowWorker}) so this stays a pure library: the
 * app backs them with Web Workers, tests with {@link inProcessFlowWorker}.
 */

import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import type { PassageTable } from "./passages";
import type { BitSet } from "./bitset";
import { DEFAULT_PORTAL_FLOW_OPTIONS, EMPTY_FLOW_STATS, type PortalFlowOptions, type PortalFlowResult, type SourceFlow, addSourceStats, flowFromSource, portalFlowOrder } from "./portalFlow";

/** A finished portal vis row, sent to workers to prune later sources. */
export interface FlowRow {
  readonly id: number;
  readonly vis: BitSet;
}

/** One flow thread. A worker gets one `flow` call at a time. */
export interface FlowWorker {
  /**
   * Starts a run over `graph` / `mightSee`, with `rank[i]` = position of portal i in the flow order
   * and optional canSee rows (`PortalFlowOptions.passages`). Forgets earlier runs.
   */
  begin<D extends Dim>(graph: PortalGraph<D>, mightSee: readonly BitSet[], clipSource: boolean, rank: Int32Array, passages: PassageTable | null): Promise<void>;
  /** Adds `known` rows, then flows `sources`, sharing `budget` generator tests (`Infinity`: unlimited). */
  flow(known: readonly FlowRow[], sources: readonly number[], budget: number): Promise<SourceFlow[]>;
}

/** How much parallelism the dependency graph allowed. */
export interface ParallelFlowStats {
  /** Most sources ready to run at once. */
  readonly maxReady: number;
  /** Average number of ready sources (queued or just taken), sampled at each dispatch. */
  readonly meanReady: number;
}

/** {@link PortalFlowResult} plus scheduling statistics. */
export interface ParallelFlowResult extends PortalFlowResult {
  readonly parallel: ParallelFlowStats;
}

/** Most ready sources handed to one worker per call: fewer round trips, still balanced. */
const MAX_BATCH = 8;

/**
 * The worker-side state of a run: graph, base vis and the rows received so far.
 * `flow` has the {@link FlowWorker.flow} contract, synchronously.
 */
export function createFlowSession<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], clipSource: boolean, rank: Int32Array, passages: PassageTable | null = null) {
  const known: (BitSet | undefined)[] = new Array(graph.portals.length);
  const onChain = new Uint8Array(graph.leafCount);
  return {
    flow(rows: readonly FlowRow[], sources: readonly number[], budget: number): SourceFlow[] {
      for (const r of rows) known[r.id] = r.vis;
      const out: SourceFlow[] = [];
      let left = budget;
      for (const id of sources) {
        // A batch's sources never depend on each other (all were ready together), so no rows are shared within it.
        const r = left > 0 ? flowFromSource(geometry, graph, mightSee, known, id, clipSource, left, onChain, rank, true, passages)
          : { sourceId: id, vis: mightSee[id].clone(), steps: 0, maxChainDepth: 0, truncated: true, facetClips: 0, separatorClips: 0 };
        left -= r.steps;
        out.push(r);
      }
      return out;
    },
  };
}

/** A {@link FlowWorker} running on the calling thread (tests, and a fallback). */
export function inProcessFlowWorker<D extends Dim>(geometry: Geometry<D>): FlowWorker {
  let session: ReturnType<typeof createFlowSession<D>> | null = null;
  return {
    async begin(graph, mightSee, clipSource, rank, passages) {
      session = createFlowSession(geometry, graph as unknown as PortalGraph<D>, mightSee, clipSource, rank, passages);
    },
    async flow(known, sources, budget) {
      if (!session) throw new Error("flow before begin");
      return session.flow(known, sources, budget);
    },
  };
}

/**
 * deps(i) for every source, as dependents lists plus unmet-dependency counts.
 * `dependents[j]`: sources waiting on j. `pending[i]` = |deps(i)|.
 */
function dependencyGraph(mightSee: readonly BitSet[], rank: Int32Array): { dependents: number[][]; pending: Int32Array } {
  const n = mightSee.length;
  const dependents: number[][] = Array.from({ length: n }, () => []);
  const pending = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const words = mightSee[i].words;
    for (let w = 0; w < words.length; w++) {
      for (let bits = words[w]; bits !== 0; bits &= bits - 1) {
        const j = (w << 5) | (31 - Math.clz32(bits & -bits));
        if (j < n && rank[j] < rank[i]) {
          dependents[j].push(i);
          pending[i]++;
        }
      }
    }
  }
  return { dependents, pending };
}

/** Min-heap of portal ids keyed by `rank`, so ready sources run in flow order. */
function rankHeap(rank: Int32Array) {
  const a: number[] = [];
  const less = (x: number, y: number) => rank[a[x]] < rank[a[y]];
  const swap = (x: number, y: number) => { const t = a[x]; a[x] = a[y]; a[y] = t; };
  return {
    get size() { return a.length; },
    push(id: number): void {
      a.push(id);
      for (let i = a.length - 1; i > 0;) {
        const p = (i - 1) >> 1;
        if (!less(i, p)) break;
        swap(i, p);
        i = p;
      }
    },
    pop(): number {
      const top = a[0];
      const last = a.pop()!;
      if (a.length) {
        a[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && less(l, m)) m = l;
          if (r < a.length && less(r, m)) m = r;
          if (m === i) break;
          swap(i, m);
          i = m;
        }
      }
      return top;
    },
  };
}

/** Portal flow spread over `workers` (at least one); same `portalVis` as `computePortalFlow` unless truncated. */
export async function computePortalFlowParallel<D extends Dim>(graph: PortalGraph<D>, mightSee: readonly BitSet[], workers: readonly FlowWorker[], options: Partial<PortalFlowOptions> = {}): Promise<ParallelFlowResult> {
  if (workers.length === 0) throw new Error("computePortalFlowParallel needs at least one worker");
  const opts: PortalFlowOptions = { ...DEFAULT_PORTAL_FLOW_OPTIONS, ...options };
  const n = mightSee.length;
  const rank = new Int32Array(n);
  portalFlowOrder(opts.orderBy ?? mightSee).forEach((id, r) => { rank[id] = r; });
  const { dependents, pending } = dependencyGraph(mightSee, rank);

  const portalVis: BitSet[] = new Array(n);
  const sent = workers.map(() => new Uint8Array(n)); // sent[w][j]: worker w has row j
  const ready = rankHeap(rank);
  for (let i = 0; i < n; i++) if (pending[i] === 0) ready.push(i);
  let stats = EMPTY_FLOW_STATS;
  let truncated = false;
  let finished = 0;
  let maxReady = 0, readySum = 0, dispatches = 0;

  await Promise.all(workers.map((w) => w.begin(graph, mightSee, opts.clipSource, rank, opts.passages)));
  if (n === 0) return { portalVis, stats, parallel: { maxReady, meanReady: 0 } };

  const complete = (r: SourceFlow): void => {
    portalVis[r.sourceId] = r.vis;
    finished++;
    stats = addSourceStats(stats, r);
    if (stats.truncated || (opts.maxSteps > 0 && stats.steps > opts.maxSteps)) truncated = true;
    for (const k of dependents[r.sourceId]) if (--pending[k] === 0) ready.push(k);
  };

  await new Promise<void>((resolve, reject) => {
    let failed = false;
    const idle = workers.map((_, i) => i);
    const pump = (): void => {
      if (failed) return;
      while (idle.length && ready.size) {
        const wi = idle.pop()!;
        maxReady = Math.max(maxReady, ready.size);
        readySum += ready.size;
        dispatches++;
        // Spread the ready sources over the idle workers.
        const batch: number[] = [];
        const take = Math.min(MAX_BATCH, Math.ceil(ready.size / (idle.length + 1)));
        while (batch.length < take && ready.size) batch.push(ready.pop());
        if (truncated) {
          // Out of budget: fall back to base vis without a round trip.
          for (const id of batch) complete({ sourceId: id, vis: mightSee[id].clone(), steps: 0, maxChainDepth: 0, truncated: true, facetClips: 0, separatorClips: 0 });
          idle.push(wi);
          continue;
        }
        // Rows this worker lacks among the batch's dependencies.
        const has = sent[wi];
        const known: FlowRow[] = [];
        for (const id of batch) collectDeps(id, has, known);
        const budget = opts.maxSteps > 0 ? opts.maxSteps - stats.steps : Infinity; // whole remainder per batch: may overshoot (see header)
        workers[wi].flow(known, batch, budget).then((results) => {
          for (const r of results) complete(r);
          idle.push(wi);
          if (finished === n) resolve();
          else pump();
        }, (e: unknown) => {
          failed = true;
          reject(e);
        });
      }
      if (finished === n) resolve();
    };

    /** Appends rows of deps(id) not yet sent to the worker owning `has`, marking them sent. */
    const collectDeps = (id: number, has: Uint8Array, out: FlowRow[]): void => {
      const words = mightSee[id].words;
      for (let w = 0; w < words.length; w++) {
        for (let bits = words[w]; bits !== 0; bits &= bits - 1) {
          const j = (w << 5) | (31 - Math.clz32(bits & -bits));
          if (j < n && rank[j] < rank[id] && !has[j]) {
            has[j] = 1;
            out.push({ id: j, vis: portalVis[j] });
          }
        }
      }
    };

    pump();
  });

  return { portalVis, stats: { ...stats, truncated }, parallel: { maxReady, meanReady: dispatches ? readySum / dispatches : 0 } };
}
