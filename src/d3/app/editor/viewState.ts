/**
 * View-only state: debug layers, the work plane, snapping, and what the
 * inspect tool is probing. Nothing here affects compilation.
 */

import type { Vec3 } from "../../core";

export interface Layers {
  grid: boolean;
  surfaces: boolean;
  brushes: boolean;
  walls: boolean;
  leaves: boolean;
  splitters: boolean;
  portals: boolean;
  labels: boolean;
  pvs: boolean;
  hideCulled: boolean;
  lineOfSight: boolean;
}

export const LAYER_LABELS: Record<keyof Layers, string> = {
  grid: "Grid (work plane)",
  surfaces: "Surfaces (shaded)",
  brushes: "Brush outlines",
  walls: "Wall edges",
  leaves: "BSP leaf cells",
  splitters: "BSP splitters",
  portals: "Portals",
  labels: "Leaf / portal ids",
  pvs: "PVS colouring",
  hideCulled: "Hide culled surfaces",
  lineOfSight: "True line of sight (rays)",
};

export interface InspectState {
  /** World point being probed (hover or pinned), or null. */
  point: Vec3 | null;
  /** If pinned, hovering no longer moves the probe. */
  pinned: boolean;
  /** Probe from the camera position instead (walk through the level and watch the PVS). */
  fromCamera: boolean;
  /** Portal under the cursor (shows its portal vis), or null. */
  portal: number | null;
}

export class ViewState {
  layers: Layers = {
    grid: true,
    surfaces: true,
    brushes: true,
    walls: false,
    leaves: false,
    splitters: false,
    portals: true,
    labels: false,
    pvs: true,
    hideCulled: false,
    lineOfSight: true,
  };

  inspect: InspectState = { point: null, pinned: false, fromCamera: false, portal: null };

  /** Height of the horizontal work plane new brushes are drawn on. */
  workZ = 0;
  /** Height of new brushes (negative = extrude downwards). */
  brushHeight = 3;

  /** Grid / snapping step in world units. */
  gridSize = 1;
  snap = true;

  snapValue(v: number): number {
    if (!this.snap || this.gridSize <= 0) return v;
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  snapPoint(p: Vec3): Vec3 {
    return { x: this.snapValue(p.x), y: this.snapValue(p.y), z: this.snapValue(p.z) };
  }
}
