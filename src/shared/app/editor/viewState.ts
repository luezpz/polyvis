/**
 * View-state core shared by both editors: the debug layers every editor has,
 * the inspect probe, and grid snapping. Each dimension extends it with its
 * own layers / inspect fields (e.g. 3D surfaces, work plane). Nothing here
 * affects compilation.
 */

/** Debug layers present in both editors. */
export interface BaseLayers {
  grid: boolean;
  brushes: boolean;
  walls: boolean;
  leaves: boolean;
  splitters: boolean;
  portals: boolean;
  portalGraph: boolean;
  clusters: boolean;
  pvsHeat: boolean;
  labels: boolean;
  pvs: boolean;
  lineOfSight: boolean;
}

/** Default panel labels of the shared layers; dimensions may override individual entries. */
export const BASE_LAYER_LABELS: Readonly<Record<keyof BaseLayers, string>> = {
  grid: "Grid",
  brushes: "Brushes",
  walls: "Walls (CSG result)",
  leaves: "BSP leaves",
  splitters: "BSP splitters",
  portals: "Portals",
  portalGraph: "Portal graph",
  clusters: "Vis clusters",
  pvsHeat: "PVS size heatmap",
  labels: "Leaf / portal ids",
  pvs: "PVS of probed leaf",
  lineOfSight: "True line of sight",
};

/** What the inspect tool is probing; `V` is the dimension's vector type. */
export interface BaseInspectState<V> {
  /** World point being probed (hover or pinned), or null. */
  point: V | null;
  /** If pinned, hovering no longer moves the probe. */
  pinned: boolean;
  /** Portal under the cursor (shows its portal vis), or null. */
  portal: number | null;
}

/** A vector whose every field is a coordinate (`Vec2`, `Vec3`). */
type Coords<V> = { readonly [K in keyof V]: number };

export abstract class BaseViewState<V extends Coords<V>, L extends BaseLayers, I extends BaseInspectState<V>> {
  abstract layers: L;
  abstract inspect: I;

  /** Grid / snapping step in world units (0 disables snapping). */
  gridSize = 1;
  snap = true;

  /** Rounds `v` to the grid when snapping is on. */
  snapValue(v: number): number {
    if (!this.snap || this.gridSize <= 0) return v;
    return Math.round(v / this.gridSize) * this.gridSize;
  }

  /** Snaps every coordinate of `p` to the grid. */
  snapPoint(p: V): V {
    const out: Record<string, number> = {};
    for (const k of Object.keys(p) as (keyof V & string)[]) out[k] = this.snapValue(p[k]);
    return out as V;
  }

  /** Forgets the probe point, pin and hovered portal (other inspect fields are kept). */
  clearProbe(): void {
    this.inspect = { ...this.inspect, point: null, pinned: false, portal: null };
  }
}
