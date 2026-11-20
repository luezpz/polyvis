/**
 * Portal visibility → leaf visibility (the PVS proper).
 *
 * A leaf sees itself, its direct neighbours, and every leaf that any of its
 * outgoing portals can see into (Golodetz Listing 6).
 */

import type { BspTree } from "../bsp";
import type { Dim } from "../geometry";
import type { PortalGraph } from "../portals";
import { BitSet } from "./bitset";

/**
 * How to reconcile A→B and B→A results. True visibility is symmetric and the
 * flow is conservative in both directions, so intersecting the two is still
 * conservative and slightly tighter; union is the most defensive option.
 */
export type PvsSymmetry = "none" | "intersect" | "union";

/**
 * Returns one PVS row per BSP leaf (solid and degenerate leaves get empty rows).
 * Symmetry uses the transpose T (T[a] has b iff row b has a), built in O(set bits), then one
 * word-wise AND / OR per row: O(L² / 32) instead of a per-bit pass over every leaf pair.
 */
export function computeLeafPvs<D extends Dim>(tree: BspTree<D>, graph: PortalGraph<D>, portalVis: readonly BitSet[], symmetry: PvsSymmetry = "none"): BitSet[] {
  const leafCount = tree.leaves.length;
  const { portals, portalsFrom } = graph;
  const pvs = tree.leaves.map((leaf, i) => {
    const row = new BitSet(leafCount);
    if (leaf.contents !== "empty" || !leaf.region) return row;
    row.set(i);
    for (const pid of portalsFrom[i]) {
      row.set(portals[pid].to);
      forEachBit(portalVis[pid], (k) => row.set(portals[k].to));
    }
    return row;
  });

  if (symmetry === "none") return pvs;
  const transpose = pvs.map(() => new BitSet(leafCount));
  pvs.forEach((row, a) => forEachBit(row, (b) => transpose[b].set(a)));
  return pvs.map((row, a) => (symmetry === "intersect" ? row.clone().andWith(transpose[a]) : row.clone().orWith(transpose[a])));
}

/** Calls `f(i)` for every set bit `i` of `set`, ascending, without allocating (word scan, lowest bit first). */
function forEachBit(set: BitSet, f: (i: number) => void): void {
  const words = set.words;
  for (let w = 0; w < words.length; w++) {
    for (let bits = words[w]; bits !== 0; bits &= bits - 1) f((w << 5) | (31 - Math.clz32(bits & -bits)));
  }
}
