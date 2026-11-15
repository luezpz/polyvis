/**
 * Leaf surfaces (Quake's "marksurfaces"): which pieces of which walls bound
 * each empty leaf.
 *
 * Every wall is pushed down the tree, split by the planes it spans. A wall
 * lying on a node's plane goes to the side its normal faces (its empty side),
 * so each piece ends up in the empty leaf it is visible from. A game engine
 * draws the surfaces of every leaf in the camera leaf's PVS row; the editor
 * uses them to render the level coloured by visibility.
 */

import type { Dim, Facet, Geometry } from "../geometry";
import { Side } from "../math";
import type { Wall } from "../wall";
import { type BspTree, type ChildRef, isLeafRef, refToLeaf } from "./types";

export interface LeafSurface<D extends Dim> {
  /** Index into the wall list the surfaces were built from. */
  readonly wall: number;
  /** The part of the wall bounding this leaf (oriented like the wall: the leaf is in front). */
  readonly winding: Facet<D>;
}

/**
 * Returns `surfaces[leaf]` for every leaf. Pieces that land in solid leaves
 * (only possible with inconsistent, e.g. self-intersecting mesh input) are
 * dropped.
 */
export function buildLeafSurfaces<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, walls: readonly Wall<D>[]): LeafSurface<D>[][] {
  const out: LeafSurface<D>[][] = tree.leaves.map(() => []);
  const push = (ref: ChildRef, w: Facet<D>, wall: number): void => {
    while (!isLeafRef(ref)) {
      const node = tree.nodes[ref];
      const plane = tree.planes[node.plane];
      const side = g.classifyFacet(plane, w);
      if (side === Side.Front) ref = node.front;
      else if (side === Side.Back) ref = node.back;
      else if (side === Side.On) ref = g.dot(walls[wall].plane.n, plane.n) > 0 ? node.front : node.back;
      else {
        const f = g.clipFacet(w, plane);
        const b = g.clipFacet(w, g.flipPlane(plane));
        if (f) push(node.front, f, wall);
        if (!b) return;
        w = b;
        ref = node.back;
      }
    }
    const leaf = refToLeaf(ref);
    if (tree.leaves[leaf].contents === "empty") out[leaf].push({ wall, winding: w });
  };
  walls.forEach((w, i) => push(tree.root, w.winding, i));
  return out;
}
