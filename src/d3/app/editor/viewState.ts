/**
 * 3D view state: the shared layers / probe / snapping, plus shaded surfaces,
 * hide-culled, probing from the camera, and the work plane.
 */

import type { Vec3 } from "../../core";
import { type BaseInspectState, type BaseLayers, BASE_LAYER_LABELS, BaseViewState } from "../../../shared/app/editor/viewState";

export interface Layers extends BaseLayers {
  surfaces: boolean;
  hideCulled: boolean;
}

export const LAYER_LABELS: Record<keyof Layers, string> = {
  ...BASE_LAYER_LABELS,
  grid: "Grid (work plane)",
  surfaces: "Surfaces (shaded)",
  brushes: "Brush outlines",
  walls: "Wall edges",
  leaves: "BSP leaf cells",
  pvs: "PVS colouring",
  hideCulled: "Hide culled surfaces",
  lineOfSight: "True line of sight (rays)",
};

export interface InspectState extends BaseInspectState<Vec3> {
  /** Probe from the camera position instead (walk through the level and watch the PVS). */
  fromCamera: boolean;
}

export class ViewState extends BaseViewState<Vec3, Layers, InspectState> {
  // Key order is the panel order.
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
}
