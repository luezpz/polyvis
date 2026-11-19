/**
 * 2D view state: the shared layers / probe / snapping, plus leaf surfaces
 * coloured by the probe's PVS and hide-culled (parity with 3D).
 */

import type { Vec2 } from "../../core";
import { type BaseInspectState, type BaseLayers, BASE_LAYER_LABELS, BaseViewState } from "../../../shared/app/editor/viewState";

export interface Layers extends BaseLayers {
  surfaces: boolean;
  hideCulled: boolean;
}
export type InspectState = BaseInspectState<Vec2>;

export const LAYER_LABELS: Record<keyof Layers, string> = {
  ...BASE_LAYER_LABELS,
  surfaces: "Surfaces (PVS coloured)",
  hideCulled: "Hide culled surfaces",
};

export class ViewState extends BaseViewState<Vec2, Layers, InspectState> {
  // Key order is the panel order.
  layers: Layers = {
    grid: true,
    brushes: true,
    leaves: true,
    splitters: false,
    walls: true,
    surfaces: true,
    portals: true,
    portalGraph: false,
    clusters: false,
    pvsHeat: false,
    labels: false,
    pvs: true,
    hideCulled: false,
    lineOfSight: true,
    runtime: false,
    runtimeRect: false,
  };

  inspect: InspectState = { point: null, pinned: false, portal: null };
}
