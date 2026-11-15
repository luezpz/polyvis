/** Read-only queries on a built BSP tree. */

import * as shared from "../../../shared/core";
import { geometry3 } from "../geometry";
import { type Vec3, type Winding, polyhedronSection } from "../math";
import type { BspTree } from "./bsp";

export { walkLeaves } from "../../../shared/core";

/** Returns the index of the leaf containing `p`. Points exactly on a plane go to the front. */
export const locateLeaf = (tree: BspTree, p: Vec3): number => shared.locateLeaf(geometry3, tree, p);

/**
 * The visible part of each node's splitter: the plane clipped to the node's
 * region. Useful for drawing the BSP. Returned in node order (null if empty).
 */
export function splitterWindings(tree: BspTree): (Winding | null)[] {
  return tree.nodes.map((node) => (node.region ? polyhedronSection(node.region, tree.planes[node.plane]) : null));
}
