/**
 * Cluster-graph portal rows → leaf-graph portal rows (phase 3e), so the leaf PVS, the editors and
 * the export keep working on leaf portal ids whether or not the vis ran on clusters.
 */

import type { Dim } from "../geometry";
import type { LeafClusters, PortalGraph } from "../portals";
import { BitSet } from "./bitset";

/**
 * Expands `rows` (one per cluster-graph portal, bits = cluster-graph portals) to one row per portal
 * of `leafGraph` (bits = leaf portals), so that `computeLeafPvs` gives every leaf its cluster's PVS:
 * - a portal between clusters keeps its row, renumbered, plus the internal portals of every cluster
 *   it reaches (seeing a cluster means seeing all its leaves);
 * - a portal inside cluster c gets everything c sees: c's internal and outgoing portals, their rows.
 */
export function expandClusterRows<D extends Dim>(leafGraph: PortalGraph<D>, clusters: LeafClusters<D>, rows: readonly BitSet[]): BitSet[] {
  const n = leafGraph.portals.length;
  const { leafCluster, leafPortal, graph } = clusters;
  // Internal portals of each cluster that has any.
  const internal: (BitSet | undefined)[] = new Array(clusters.count);
  for (const p of leafGraph.portals) {
    const c = leafCluster[p.from];
    if (c === leafCluster[p.to]) (internal[c] ??= new BitSet(n)).set(p.id);
  }
  const reach = (k: number, into: BitSet) => {
    into.set(leafPortal[k]);
    const inside = internal[graph.portals[k].to];
    if (inside) into.orWith(inside);
  };
  // A portal into X also shows all of X: its row gets X's internal portals.
  const external = rows.map((row, k) => {
    const out = internal[graph.portals[k].to]?.clone() ?? new BitSet(n);
    for (const j of row.toArray()) reach(j, out);
    return out;
  });
  const out: BitSet[] = new Array(n);
  leafPortal.forEach((leafId, k) => { out[leafId] = external[k]; });

  const seen: (BitSet | undefined)[] = new Array(clusters.count);
  for (let c = 0; c < clusters.count; c++) {
    if (!internal[c]) continue;
    const row = internal[c]!.clone();
    for (const k of graph.portalsFrom[c]) { reach(k, row); row.orWith(external[k]); }
    seen[c] = row;
  }
  for (const p of leafGraph.portals) if (!out[p.id]) out[p.id] = seen[leafCluster[p.from]]!;
  return out;
}
