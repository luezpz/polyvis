/**
 * The leaf/portal graph.
 *
 * A portal is the shared boundary between two *empty* convex leaves. Every
 * geometric opening yields two *directed* portals, one per direction. A
 * directed portal `p` leads from leaf `p.from` into leaf `p.to`; its plane's
 * normal points into `p.to` and its winding is oriented accordingly (2D: `to`
 * on the left of a→b; 3D: CCW seen from `to`).
 *
 * The graph has leaves as nodes and directed portals as edges. *Finding* the
 * portals is geometry and lives in each dimension (`portals/portals.ts`).
 */

import type { BspTree } from "../bsp";
import type { Dim, Facet, Plane } from "../geometry";

export interface Portal<D extends Dim> {
  /** Index of this portal in {@link PortalGraph.portals}. */
  readonly id: number;
  /** Leaf the portal leads out of. */
  readonly from: number;
  /** Leaf the portal leads into. */
  readonly to: number;
  /** BSP plane index the portal lies on. */
  readonly planeIndex: number;
  /** Plane with the normal pointing into `to`. */
  readonly plane: Plane<D>;
  /** The opening, oriented around `plane.n`. */
  readonly winding: Facet<D>;
  /** Index of the reverse portal (to → from). */
  readonly twin: number;
}

export interface PortalGraph<D extends Dim> {
  readonly leafCount: number;
  readonly portals: readonly Portal<D>[];
  /** `portalsFrom[leaf]` = ids of portals leading out of `leaf`. */
  readonly portalsFrom: readonly (readonly number[])[];
}

/** Connected components of empty leaves, as a leaf → component id map (-1 for solid/degenerate leaves). */
export function leafComponents<D extends Dim>(tree: BspTree<D>, graph: PortalGraph<D>): Int32Array {
  const comp = new Int32Array(tree.leaves.length).fill(-1);
  let next = 0;
  for (let start = 0; start < tree.leaves.length; start++) {
    const leaf = tree.leaves[start];
    if (comp[start] !== -1 || leaf.contents !== "empty" || !leaf.region) continue;
    const stack = [start];
    comp[start] = next;
    while (stack.length) {
      const l = stack.pop()!;
      for (const pid of graph.portalsFrom[l]) {
        const to = graph.portals[pid].to;
        if (comp[to] === -1) {
          comp[to] = next;
          stack.push(to);
        }
      }
    }
    next++;
  }
  return comp;
}
