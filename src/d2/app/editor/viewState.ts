/** 2D view state: the shared layers / probe / snapping, nothing extra. */

import type { Vec2 } from "../../core";
import { type BaseInspectState, type BaseLayers, BASE_LAYER_LABELS, BaseViewState } from "../../../shared/app/editor/viewState";

export type Layers = BaseLayers;
export type InspectState = BaseInspectState<Vec2>;

export const LAYER_LABELS: Record<keyof Layers, string> = { ...BASE_LAYER_LABELS };

export class ViewState extends BaseViewState<Vec2, Layers, InspectState> {
  // Key order is the panel order.
  layers: Layers = {
    grid: true,
    brushes: true,
    leaves: true,
    splitters: false,
    walls: true,
    portals: true,
    labels: false,
    pvs: true,
    lineOfSight: true,
  };

  inspect: InspectState = { point: null, pinned: false, portal: null };
}
