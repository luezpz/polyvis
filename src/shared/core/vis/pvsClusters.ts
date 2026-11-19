/**
 * PVS clusters (optimization plan phase 3b, Quake 2 / q3map2 clusters): leaves grouped into fewer
 * export units *after* the flow, so the flow and the per-leaf PVS stay as they are and only the
 * exported table gets coarser.
 *
 * Unlike the vis clusters of phase 3e (`portals/clusters.ts`), a PVS cluster does not need to be
 * convex: nothing runs a flow over it. Two empty leaves joined by a portal merge when
 * - the portal is wide: `measure(portal) ≥ minWidth × min(section(a), section(b))`, where
 *   `section(leaf)` is the largest boundary piece (portal or wall surface) of the leaf, a cheap,
 *   dimension-agnostic stand-in for its cross-section (2D: lengths, 3D: areas); or
 * - the portal lies on a refinement split (`refinementPortals`) and `refinement` is on.
 * Merges go widest portal first. Precision guard: the leaf PVS is known at this point, so a merge of
 * clusters A, B (leaf rows ORed: P_A, P_B; n_A, n_B leaves) is refused when the merged cluster's
 * leaves would see more than `1 + maxGrowth` times what they see exactly (E_X = Σ_{l∈X} |pvs[l]|):
 *
 *   (n_A + n_B)·|P_A ∪ P_B| > (1 + maxGrowth)·(E_A + E_B).
 *
 * Compared against the exact sums, not the previous cluster rows, so the growth does not compound
 * across merges. It counts the viewer side only: seeing a merged cluster also means seeing all its
 * leaves, which the bench's "Σ cluster pvs (leaves)" column includes. `maxLeaves` is a hard cap.
 *
 * Conservative by construction: cluster A sees cluster B iff some leaf of A sees some leaf of B,
 *
 *   clusterPvs[A] = { leafCluster[j] : j ∈ pvs[l], leafCluster[l] = A },
 *
 * so `pvs[a].has(b) ⇒ clusterPvs[leafCluster[a]].has(leafCluster[b])`. Lossy: every leaf of a
 * cluster sees what any of them sees. Non-empty leaves share one cluster (their rows are empty).
 */

import type { BspTree } from "../bsp";
import type { Dim, Geometry } from "../geometry";
import { type PortalGraph, refinementPortals } from "../portals";
import { BitSet } from "./bitset";
import { type PvsTable, buildPvsTable } from "./pvsTable";

export interface PvsClusterOptions {
  /** Portal measure ≥ this × the smaller leaf section merges (0..1; > 1 disables width merges). */
  readonly minWidth: number;
  /** Also merge across refinement splits (corner / cell-size splits of `bsp/refine.ts`). */
  readonly refinement: boolean;
  /** Clusters never grow beyond this many leaves (0: unlimited). */
  readonly maxLeaves: number;
  /** Refuse merges that grow their leaves' Σ visible leaves by more than this fraction (Infinity: no guard). */
  readonly maxGrowth: number;
}

export const DEFAULT_PVS_CLUSTER_OPTIONS: PvsClusterOptions = Object.freeze({ minWidth: 0.5, refinement: true, maxLeaves: 0, maxGrowth: 0.1 });

export interface PvsClusters {
  /** `leafCluster[leaf]` = cluster id in `[0, count)`; every leaf has one. */
  readonly leafCluster: Int32Array;
  readonly count: number;
  /** `pvs[c]` = clusters potentially visible from cluster `c` (bits indexed by cluster). */
  readonly pvs: readonly BitSet[];
  /** `pvs` with row and column sharing (phase 3c), the export form. */
  readonly table: PvsTable;
}

/**
 * Groups the leaves of `tree` into PVS clusters and builds their PVS from the leaf PVS.
 * `wallMeasures[leaf]`: measures of the wall surfaces bounding each leaf (for `section`).
 * `pvs[leaf]`: leaf PVS rows (bits indexed by leaf). Deterministic.
 */
export function buildPvsClusters<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, graph: PortalGraph<D>, wallMeasures: readonly (readonly number[])[], pvs: readonly BitSet[], options: Partial<PvsClusterOptions> = {}): PvsClusters {
  const leafCluster = clusterLeaves(g, tree, graph, wallMeasures, pvs, { ...DEFAULT_PVS_CLUSTER_OPTIONS, ...options });
  const count = leafCluster.reduce((m, c) => Math.max(m, c + 1), 0);
  const clusterPvs = clusterRows(leafCluster, count, pvs);
  return { leafCluster, count, pvs: clusterPvs, table: buildPvsTable(clusterPvs) };
}

/** Union-find merge of the leaves (see the module comment); returns compact ids in leaf order. */
function clusterLeaves<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, graph: PortalGraph<D>, wallMeasures: readonly (readonly number[])[], pvs: readonly BitSet[], o: PvsClusterOptions): Int32Array {
  const n = tree.leaves.length;
  const { portals } = graph;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const size = new Int32Array(n).fill(1);
  // Per root: ORed leaf rows (built lazily) and the exact Σ |pvs[l]| of its leaves (precision guard).
  const guard = Number.isFinite(o.maxGrowth);
  const rows: (BitSet | null)[] = new Array(n).fill(null);
  const exact = guard ? Float64Array.from(pvs, (r) => r.count()) : new Float64Array(n);
  const rowOf = (r: number) => (rows[r] ??= pvs[r].clone());
  /** Merges root b into root a if the guard allows it; returns whether it did. */
  const tryUnion = (a: number, b: number): boolean => {
    if (guard) {
      const merged = rowOf(a).clone().orWith(rowOf(b));
      if ((size[a] + size[b]) * merged.count() > (1 + o.maxGrowth) * (exact[a] + exact[b])) return false;
      rows[a] = merged;
      exact[a] += exact[b];
      rows[b] = null;
    }
    parent[b] = a;
    size[a] += size[b];
    return true;
  };

  // Non-empty leaves: one shared cluster, never counted against maxLeaves.
  let solid = -1;
  tree.leaves.forEach((l, i) => {
    if (l.contents === "empty") return;
    if (solid < 0) solid = i;
    else parent[i] = solid;
  });

  const measure = portals.map((p) => g.facetMeasure(p.winding));
  const section = wallMeasures.map((ws) => Math.max(0, ...ws));
  for (const p of portals) section[p.from] = Math.max(section[p.from], measure[p.id]);
  const refine = o.refinement ? refinementPortals(tree, graph) : null;
  // Each undirected pair once (`from < to`), widest first, id breaks ties.
  const order = portals.filter((p) => p.from < p.to).map((p) => p.id).sort((a, b) => measure[b] - measure[a] || a - b);
  for (const id of order) {
    const p = portals[id];
    const a = find(p.from), b = find(p.to);
    if (a === b || (o.maxLeaves > 0 && size[a] + size[b] > o.maxLeaves)) continue;
    const wide = measure[id] >= o.minWidth * Math.min(section[p.from], section[p.to]);
    if (wide || refine?.[id]) tryUnion(a, b);
  }

  const out = new Int32Array(n);
  const idOfRoot = new Int32Array(n).fill(-1);
  let count = 0;
  for (let l = 0; l < n; l++) {
    const r = find(l);
    if (idOfRoot[r] < 0) idOfRoot[r] = count++;
    out[l] = idOfRoot[r];
  }
  return out;
}

/** `rows[c]` = the leaf rows of cluster `c` ORed, then re-indexed by cluster (see the module comment). */
function clusterRows(leafCluster: Int32Array, count: number, pvs: readonly BitSet[]): BitSet[] {
  const leafWide = Array.from({ length: count }, () => new BitSet(pvs.length));
  pvs.forEach((row, l) => leafWide[leafCluster[l]].orWith(row));
  return leafWide.map((row) => {
    const out = new BitSet(count);
    for (let j = 0; j < pvs.length; j++) if (row.has(j)) out.set(leafCluster[j]);
    return out;
  });
}
