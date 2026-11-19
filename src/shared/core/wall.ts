/** Walls: the input of the BSP compiler, produced by CSG or taken from raw geometry. */

import type { Dim, Facet, Plane } from "./geometry";

/** A boundary piece of the empty space. Empty space is in front of it. */
export interface Wall<D extends Dim> {
  /** Convex facet (2D: segment with the front on its left; 3D: polygon, CCW seen from the front). */
  readonly winding: Facet<D>;
  /** Supporting plane; its normal points into empty space. */
  readonly plane: Plane<D>;
  /** Brush (or imported mesh, negated) that contributed this wall, for debugging/highlighting; -1 if unknown. */
  readonly sourceId: number;
  /**
   * Splitter bias (phase 3d, hint faces), in units of "wall fragments split": added to the BSP score of
   * this wall's plane, so negative = prefer it as a splitter, positive = avoid it. Absent / 0: no vote.
   * A plane takes the lowest bias among the walls on it that vote (see `prepareBuild`). Changes the tree
   * only, never visibility rules: the PVS stays conservative for any tree.
   */
  readonly splitBias?: number;
}
