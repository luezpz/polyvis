/**
 * Phase 3.5: incremental portal flow. After an edit, reuse a source portal's
 * previous flow row when every input `flowFromSource` reads for it is unchanged;
 * run the flow only for the rest.
 *
 * Portals are matched across compiles by exact geometry ({@link portalKey}: plane and
 * winding numbers, which also fix the direction). Single-threaded, source i reads only:
 *
 *   - its own winding/plane and those of portals in M = mightSee[i] (`might ⊆ M`),
 *   - leaf identities of those portals (`onChain`) and, per reached leaf, the
 *     generators `portalsFrom[leaf] ∩ M` in order,
 *   - for each p ∈ M: `known[p]` = portalVis[p] if rank(p) < rank(i), else mightSee[p];
 *     only bits inside M matter (they are ANDed with `might`).
 *
 * If all of these map one-to-one onto the previous compile, the walk is the same, so the
 * previous row (mapped to new ids) is exactly what a fresh flow would produce. Checked in
 * flow order, so the rows of earlier sources (reused or recomputed) are final when compared.
 *
 * Not reused: with passages (`PortalFlowOptions.passages`), with different flow options, or
 * after a truncated run. Stats count only the recomputed sources, so a run that would have hit
 * `maxSteps` fresh may finish here (results then differ from fresh, both conservative).
 */

import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import type { BitSet } from "./bitset";
import { LeafBinder, matchPortals, portalKeyIds } from "./portalMatch";
import { DEFAULT_PORTAL_FLOW_OPTIONS, EMPTY_FLOW_STATS, type PortalFlowOptions, type PortalFlowResult, addSourceStats, flowFromSource, portalFlowOrder } from "./portalFlow";

/** What a later incremental flow needs from a previous one. Treat as opaque. */
export interface FlowCache<D extends Dim> {
  readonly graph: PortalGraph<D>;
  readonly mightSee: readonly BitSet[];
  readonly portalVis: readonly BitSet[];
  /** `rank[p]` = position of portal p in the flow order. */
  readonly rank: Int32Array;
  /** Exact geometry key → portal id (absent for keys shared by several portals). */
  readonly ids: ReadonlyMap<string, number>;
  readonly clipSource: boolean;
  readonly cacheSeparators: boolean;
  /** False if the run used passages or was truncated: never reused. */
  readonly reusable: boolean;
}

/** {@link PortalFlowResult} plus the cache for the next run and how many sources were reused. */
export interface IncrementalFlowResult<D extends Dim> extends PortalFlowResult {
  readonly cache: FlowCache<D>;
  readonly reused: number;
}

/**
 * Portal flow that reuses rows of `prev` (null: none) where exact; otherwise the same as
 * `computePortalFlow`. Returns the rows, stats of the recomputed sources, and a new cache.
 * `ids`: `portalKeyIds(g, graph)` if already computed.
 */
export function computePortalFlowIncremental<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], options: Partial<PortalFlowOptions>, prev: FlowCache<D> | null, ids: ReadonlyMap<string, number> = portalKeyIds(g, graph)): IncrementalFlowResult<D> {
  const opts: PortalFlowOptions = { ...DEFAULT_PORTAL_FLOW_OPTIONS, ...options };
  const n = graph.portals.length;
  const order = portalFlowOrder(opts.orderBy ?? mightSee);
  const rank = new Int32Array(n);
  order.forEach((id, r) => (rank[id] = r));
  const usable = prev && prev.reusable && !opts.passages && prev.clipSource === opts.clipSource && prev.cacheSeparators === opts.cacheSeparators ? prev : null;
  const reuse = usable ? createReuseCheck(graph, mightSee, rank, ids, usable) : null;

  const portalVis: BitSet[] = new Array(n);
  const onChain = new Uint8Array(graph.leafCount);
  let stats = EMPTY_FLOW_STATS;
  let reused = 0;
  for (const sourceId of order) {
    if (stats.truncated) {
      portalVis[sourceId] = mightSee[sourceId].clone();
      continue;
    }
    const row = reuse ? reuse(sourceId, portalVis) : null;
    if (row) {
      portalVis[sourceId] = row;
      reused++;
      continue;
    }
    const budget = opts.maxSteps > 0 ? opts.maxSteps - stats.steps : Infinity;
    const r = flowFromSource(g, graph, mightSee, portalVis, sourceId, opts.clipSource, budget, onChain, null, opts.cacheSeparators, opts.passages);
    portalVis[sourceId] = r.vis;
    stats = addSourceStats(stats, r);
  }

  const cache: FlowCache<D> = { graph, mightSee, portalVis, rank, ids, clipSource: opts.clipSource, cacheSeparators: opts.cacheSeparators, reusable: !opts.passages && !stats.truncated };
  return { portalVis, stats, cache, reused };
}

/**
 * Returns `reuse(i, portalVis)`: source i's previous row in new ids if a fresh flow would give
 * exactly it (see the module comment), else null. `portalVis` must hold every source ranked before i.
 */
function createReuseCheck<D extends Dim>(graph: PortalGraph<D>, mightSee: readonly BitSet[], rank: Int32Array, ids: ReadonlyMap<string, number>, prev: FlowCache<D>) {
  const n = graph.portals.length;
  const old = prev.graph;
  const { match, remap } = matchPortals(ids, n, prev.ids, old.portals.length);
  const oldMight: (BitSet | undefined)[] = new Array(n);
  const oldVis: (BitSet | undefined)[] = new Array(n);
  const mightOf = (p: number) => (oldMight[p] ??= remap(prev.mightSee[match[p]]));
  const visOf = (p: number) => (oldVis[p] ??= remap(prev.portalVis[match[p]]));
  const leaves = new LeafBinder();

  return (i: number, portalVis: readonly BitSet[]): BitSet | null => {
    const o = match[i];
    if (o < 0) return null;
    const m = mightSee[i];
    // M maps onto the old M exactly: same count, every new bit matched into it.
    if (m.count() !== prev.mightSee[o].count() || !m.equals(mightOf(i))) return null;
    const members = m.toArray();
    leaves.reset();
    for (const p of [i, ...members]) {
      const q = old.portals[match[p]], np = graph.portals[p];
      if (!leaves.bind(np.from, q.from) || !leaves.bind(np.to, q.to)) return null;
    }
    // Generators per reached leaf (`to` of the source and of every member), in order.
    for (const p of [i, ...members]) {
      const leaf = graph.portals[p].to;
      const a = graph.portalsFrom[leaf].filter((x) => m.has(x));
      const b = old.portalsFrom[leaves.oldOf(leaf)!].filter((x) => prev.mightSee[o].has(x));
      if (a.length !== b.length || a.some((x, k) => match[x] !== b[k])) return null;
    }
    // Rows each member contributes, restricted to M.
    const ri = rank[i], roi = prev.rank[o];
    for (const p of members) {
      const before = rank[p] < ri;
      if (before !== prev.rank[match[p]] < roi) return null;
      const a = before ? portalVis[p] : mightSee[p];
      const b = before ? visOf(p) : mightOf(p);
      if (!agreeOn(a, b, m)) return null;
    }
    return visOf(i).clone();
  };
}

/** True if `a` and `b` have the same bits inside `mask` (all the same size). */
function agreeOn(a: BitSet, b: BitSet, mask: BitSet): boolean {
  const aw = a.words, bw = b.words, mw = mask.words;
  for (let k = 0; k < mw.length; k++) if (((aw[k] ^ bw[k]) & mw[k]) !== 0) return false;
  return true;
}
