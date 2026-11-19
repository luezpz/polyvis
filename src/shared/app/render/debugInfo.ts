/**
 * Derived debug data for the editors' visualization layers (portal graph, clusters, PVS heat),
 * computed once per compile result and cached. Pure data; each editor draws it its own way.
 */

import { type CompileResult, type Dim, refinementPortals } from "../../core";
import { leafHue } from "./palette";

/** What a portal separates: why its two leaves are distinct cells. */
export const PortalKind = {
  /** The leaves are split by a wall plane extended through empty space. */
  WallSplit: 0,
  /** The leaves are split by a refinement plane (corner / cell-size split). */
  Refinement: 1,
  /** Both leaves are in the same vis cluster: the flow never sees this portal. */
  ClusterInternal: 2,
} as const;

export const PORTAL_KIND_NAMES = ["wall-plane split", "refinement split", "inside a vis cluster"] as const;

export interface DebugInfo {
  /** `portalKind[portal]`, see {@link PortalKind}. */
  readonly portalKind: Uint8Array;
  /** `leafGroup[leaf]` = vis cluster id, or the leaf itself when the compile had no clusters. */
  readonly leafGroup: Int32Array;
  /** `pvsHeat[leaf]` = PVS size / largest PVS size, 0..1 (0 for solid leaves). */
  readonly pvsHeat: Float32Array;
}

const cache = new WeakMap<object, DebugInfo>();

/** {@link DebugInfo} of `result`, built on first use. */
export function debugInfo<D extends Dim>(result: CompileResult<D>): DebugInfo {
  let info = cache.get(result);
  if (!info) cache.set(result, (info = buildDebugInfo(result)));
  return info;
}

function buildDebugInfo<D extends Dim>(result: CompileResult<D>): DebugInfo {
  const { tree, graph, pvs, clusters } = result;
  const portalKind = refinementPortals(tree, graph); // 0 / 1 = PortalKind.WallSplit / Refinement
  if (clusters) for (const p of graph.portals) if (clusters.leafCluster[p.from] === clusters.leafCluster[p.to]) portalKind[p.id] = PortalKind.ClusterInternal;
  const leafGroup = clusters ? clusters.leafCluster : Int32Array.from(tree.leaves, (_, i) => i);
  const counts = tree.leaves.map((l, i) => (l.contents === "empty" && l.region ? pvs[i].count() : 0));
  const max = Math.max(1, ...counts);
  return { portalKind, leafGroup, pvsHeat: Float32Array.from(counts, (c) => c / max) };
}

/** Heat colour for `t` in 0..1 (blue → green → yellow → red), RGB 0..1. */
export function heatRgb(t: number): [number, number, number] {
  const h = (1 - Math.min(1, Math.max(0, t))) * 240; // hue: 240 blue .. 0 red
  return hslRgb(h, 0.8, 0.5);
}

/** Group colour (clusters), RGB 0..1: the same golden-angle hues as leaves. */
export function groupRgb(group: number): [number, number, number] {
  return hslRgb(leafHue(group), 0.6, 0.58);
}

/** CSS `rgba(...)` of an RGB 0..1 colour. */
export function rgbCss(c: readonly [number, number, number], alpha: number): string {
  return `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${alpha})`;
}

/** HSL → RGB, `h` in degrees, `s`, `l` and the result in 0..1. */
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** Line colour per portal kind, RGB 0..1. */
export const PORTAL_KIND_RGB: readonly (readonly [number, number, number])[] = [[1, 0.82, 0.25], [1, 0.5, 0.2], [0.55, 0.55, 0.6]];
