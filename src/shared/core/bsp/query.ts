/** Read-only queries on a built BSP tree. */

import type { Dim, Geometry, Vec } from "../geometry";
import { type BspTree, type ChildRef, isLeafRef, refToLeaf } from "./types";

/** Returns the index of the leaf containing `p`. Points exactly on a plane go to the front. */
export function locateLeaf<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, p: Vec<D>): number {
  let ref: ChildRef = tree.root;
  while (!isLeafRef(ref)) {
    const node = tree.nodes[ref];
    ref = g.signedDistance(tree.planes[node.plane], p) >= 0 ? node.front : node.back;
  }
  return refToLeaf(ref);
}

/** Leaf indices in depth-first order (front subtree first). */
export function* walkLeaves<D extends Dim>(tree: BspTree<D>, ref: ChildRef = tree.root): Generator<number> {
  if (isLeafRef(ref)) {
    yield refToLeaf(ref);
    return;
  }
  const node = tree.nodes[ref];
  yield* walkLeaves(tree, node.front);
  yield* walkLeaves(tree, node.back);
}
