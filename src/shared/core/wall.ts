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
}
