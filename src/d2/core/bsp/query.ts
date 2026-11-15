/** Read-only queries on a built BSP tree. */

import * as shared from "../../../shared/core";
import { geometry2 } from "../geometry";
import type { Vec2, Segment } from "../math";
import type { BspTree } from "./bsp";

export { walkLeaves } from "../../../shared/core";

/** Returns the index of the leaf containing `p`. Points exactly on a plane go to the front. */
export const locateLeaf = (tree: BspTree, p: Vec2): number => shared.locateLeaf(geometry2, tree, p);

/**
 * The visible part of each node's splitter: the plane clipped to the node's
 * region. Useful for drawing the BSP. Returned in node order (null if empty).
 */
export function splitterSegments(tree: BspTree): (Segment | null)[] {
  return tree.nodes.map((node) => {
    if (!node.region) return null;
    const line = tree.planes[node.plane];
    // Intersect the line with the convex region: clip a long segment by every region edge.
    const dir = { x: line.n.y, y: -line.n.x };
    const base = { x: line.n.x * line.d, y: line.n.y * line.d };
    const verts = node.region.vertices;
    let lo = -Infinity, hi = Infinity;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      // Inside of edge a→b is on its left: cross(b - a, p - a) >= 0.
      const ex = b.x - a.x, ey = b.y - a.y;
      const c0 = ex * (base.y - a.y) - ey * (base.x - a.x);
      const c1 = ex * dir.y - ey * dir.x; // derivative along dir
      if (Math.abs(c1) < 1e-12) {
        if (c0 < 0) return null;
        continue;
      }
      const t = -c0 / c1;
      if (c1 > 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    }
    if (!(hi > lo)) return null;
    return { a: { x: base.x + dir.x * lo, y: base.y + dir.y * lo }, b: { x: base.x + dir.x * hi, y: base.y + dir.y * hi } };
  });
}
