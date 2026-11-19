/**
 * Phase 3.5: incremental base vis. Reuses a portal's previous mightSee row after an edit when a
 * fresh `computeBaseVis` would give exactly the same row.
 *
 * Row i is a flood from leaf `to(i)` through the portals j passing rules 1 + 2 for (i, j). Those
 * tests read only the geometry of i and j, so on matched portals (`portalMatch.ts`) they give the
 * same verdicts. Let V be the leaves the old flood visited ({to(o)} ∪ {to(q) : q in the old row}).
 * If every portal leaving a leaf of V is matched, the new leaves they leave from / lead into (for
 * reached ones) correspond one-to-one, and each such leaf has no extra new portals, then the new
 * flood visits the images of V and reaches the image of the old row: reuse it. Cost per row:
 * O(portals leaving V) instead of O(all portals) plane tests.
 */

import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import { createBaseVisRows } from "./baseVis";
import { BitSet } from "./bitset";
import { LeafBinder, matchPortals, portalKeyIds } from "./portalMatch";

/** What a later incremental base vis needs from a previous one. Treat as opaque. */
export interface BaseVisCache<D extends Dim> {
  readonly graph: PortalGraph<D>;
  readonly rows: readonly BitSet[];
  /** Exact geometry key → portal id (`portalKeyIds`). */
  readonly ids: ReadonlyMap<string, number>;
}

/** Base vis rows, the cache for the next run, and how many rows were reused. */
export interface IncrementalBaseVisResult<D extends Dim> {
  readonly rows: BitSet[];
  readonly cache: BaseVisCache<D>;
  readonly reused: number;
}

/**
 * `computeBaseVis` (with spheres) that reuses rows of `prev` (null: none) where exact.
 * `ids`: `portalKeyIds(g, graph)` if already computed.
 */
export function computeBaseVisIncremental<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, prev: BaseVisCache<D> | null, ids: ReadonlyMap<string, number> = portalKeyIds(g, graph)): IncrementalBaseVisResult<D> {
  const n = graph.portals.length;
  const rows: BitSet[] = new Array(n);
  const reuse = prev ? createReuseCheck(graph, ids, prev) : null;
  let fresh: ((p0: number, p1: number) => Uint32Array) | null = null;
  let reused = 0;
  for (let i = 0; i < n; i++) {
    const row = reuse ? reuse(i) : null;
    if (row) {
      rows[i] = row;
      reused++;
      continue;
    }
    fresh ??= createBaseVisRows(g, graph);
    rows[i] = new BitSet(n, fresh(i, i + 1));
  }
  return { rows, cache: { graph, rows, ids }, reused };
}

/** Returns `reuse(i)`: portal i's previous row in new ids if a fresh flood gives exactly it, else null. */
function createReuseCheck<D extends Dim>(graph: PortalGraph<D>, ids: ReadonlyMap<string, number>, prev: BaseVisCache<D>) {
  const old = prev.graph;
  const { match, toNew, remap } = matchPortals(ids, graph.portals.length, prev.ids, old.portals.length);
  const leaves = new LeafBinder();
  return (i: number): BitSet | null => {
    const o = match[i];
    if (o < 0) return null;
    const row = prev.rows[o];
    leaves.reset();
    const visited = [old.portals[o].to, ...row.toArray().map((q) => old.portals[q].to)];
    if (!leaves.bind(graph.portals[i].to, old.portals[o].to)) return null;
    for (const leaf of new Set(visited)) {
      for (const q of old.portalsFrom[leaf]) {
        const p = toNew[q];
        if (p < 0) return null;
        const np = graph.portals[p];
        if (!leaves.bind(np.from, leaf)) return null;
        if (row.has(q) && !leaves.bind(np.to, old.portals[q].to)) return null;
      }
      const image = leaves.newOf(leaf);
      // Every old portal maps to one leaving `image`; equal counts ⇒ no extra new ones.
      if (image === undefined || graph.portalsFrom[image].length !== old.portalsFrom[leaf].length) return null;
    }
    return remap(row);
  };
}
