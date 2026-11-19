/**
 * Occluding doors (phase 4b, Doom 3 areaportals): door brushes are left out of the BSP (the level
 * is baked with every door open, conservative for any door state); at runtime the portals a door
 * seals are skipped while it is closed.
 */

import type { Cell, Dim, Geometry, Plane, Vec } from "../geometry";

/** A door's convex volume: inside = front of every plane (normals point **into** the door). */
export interface DoorVolume<D extends Dim> {
  /** Door name (from `door_<name>` / the brush's door name); several brushes may share one. */
  readonly name: string;
  readonly planes: readonly Plane<D>[];
}

/** What the compiler found for one door name. */
export interface DoorInfo {
  readonly name: string;
  /** Empty leaves inside the door's volume(s). */
  readonly leaves: readonly number[];
  /** Directed portals between a door leaf and a leaf outside the door (both directions): closed while the door is shut. */
  readonly portals: readonly number[];
  /**
   * True if the door disconnects space: with its leaves removed, the leaves around it fall into at
   * least two portal-graph components. False = the door never occludes anything (gap around it, or
   * it lies in no empty space); a closed non-sealing door still blocks the portals it covers.
   */
  readonly seals: boolean;
}

/** Average of the cell's vertices (inside the cell: it is convex). */
export function cellCentroid<D extends Dim>(g: Geometry<D>, cell: Cell<D>): Vec<D> {
  const vs = g.cellVertices(cell);
  const sum = new Array<number>(g.dimension).fill(0);
  for (const v of vs) g.coords(v).forEach((x, i) => (sum[i] += x / vs.length));
  return g.vecAt(sum, 0);
}

/** True if `p` lies deeper than `eps` in front of every plane. */
export function insideVolume<D extends Dim>(g: Geometry<D>, p: Vec<D>, planes: readonly Plane<D>[], eps: number): boolean {
  return planes.every((pl) => g.signedDistance(pl, p) > eps);
}
