/**
 * Object and light culling on top of runtime portal clipping (phase 4; Doom 3 entity/area links).
 *
 * An entity is registered in the empty leaves its bounding box touches (`leavesInBounds`, once
 * per move); it is drawn iff one of them is visible (`anyVisible`). A light's reach is
 * `visibleLeaves` from the light's position with no view (omnidirectional), intersected with
 * the leaves its radius box touches (`lightLeaves`): surfaces in other leaves are never lit by it.
 */

import type { BspTree } from "../bsp";
import { isLeafRef, refToLeaf } from "../bsp";
import type { Bounds, Dim, Geometry, Vec } from "../geometry";
import type { PortalGraph } from "../portals";
import type { BitSet } from "../vis/bitset";
import { type VisibleLeavesOptions, visibleLeaves } from "./visibleLeaves";

/**
 * Empty leaves whose subtree the box `box` reaches, ascending. Walks the BSP; at each node the box
 * goes front / back / both by its support distances along the plane normal:
 * max_{p∈box} n·p − d = Σ_i (n_i > 0 ? max_i : min_i)·n_i − d (and symmetric for the minimum).
 * Conservative: may include a leaf the box misses near a corner (boxes are tested per plane).
 */
export function leavesInBounds<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, box: Bounds<D>): number[] {
  const lo = g.coords(box.min), hi = g.coords(box.max);
  const out: number[] = [];
  const stack = [tree.root];
  while (stack.length) {
    const ref = stack.pop()!;
    if (isLeafRef(ref)) {
      const leaf = refToLeaf(ref);
      if (tree.leaves[leaf].contents === "empty") out.push(leaf);
      continue;
    }
    const node = tree.nodes[ref];
    const pl = tree.planes[node.plane];
    const n = g.coords(pl.n);
    let maxD = -pl.d, minD = -pl.d;
    for (let i = 0; i < n.length; i++) {
      maxD += n[i] * (n[i] > 0 ? hi[i] : lo[i]);
      minD += n[i] * (n[i] > 0 ? lo[i] : hi[i]);
    }
    if (maxD >= 0) stack.push(node.front);
    if (minD < 0) stack.push(node.back);
  }
  return out.sort((a, b) => a - b);
}

/** True if any of `leaves` (an object's registration) is set in `visible`. */
export const anyVisible = (leaves: readonly number[], visible: BitSet): boolean => leaves.some((l) => visible.has(l));

/**
 * Leaves a point light at `pos` (in leaf `leaf`) can reach: omnidirectional portal clipping from
 * the light, limited to the leaves its `radius` box touches. Closed doors (`portalOpen`) block light.
 */
export function lightLeaves<D extends Dim>(
  g: Geometry<D>, tree: BspTree<D>, graph: PortalGraph<D>, leaf: number, pos: Vec<D>, radius: number,
  opts: Pick<VisibleLeavesOptions<D>, "pvsRow" | "portalOpen"> = {},
): number[] {
  const reach = visibleLeaves(g, graph, leaf, pos, opts);
  const box = g.expandBounds({ min: pos, max: pos }, radius);
  return leavesInBounds(g, tree, box).filter((l) => reach.has(l));
}
