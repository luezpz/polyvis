/** Colour palette for the editor (dark theme). RGBA components are 0..1 for WebGL, CSS strings for the overlay. */

import type { BrushKind } from "../../core";
import { KIND_HEX, KIND_RGB, leafHue } from "../../../shared/app/render/palette";

export type Rgba = readonly [number, number, number, number];

export const BACKGROUND: Rgba = [0.078, 0.086, 0.102, 1];

export const GL_COLORS = {
  gridMinor: [1, 1, 1, 0.09],
  gridMajor: [1, 1, 1, 0.2],
  axisX: [0.85, 0.3, 0.3, 0.55],
  axisY: [0.35, 0.75, 0.35, 0.55],
  wall: [0.92, 0.92, 0.92, 0.55],
  leafEdge: [1, 1, 1, 0.14],
  splitter: [1, 0.62, 0.26, 0.8],
  portal: [1, 0.82, 0.25, 0.9],
  portalDim: [1, 0.82, 0.25, 0.25],
  portalFill: [1, 0.82, 0.25, 0.08],
  portalSelected: [1, 1, 1, 1],
  portalMightSee: [0.7, 0.47, 1, 0.9],
  portalVis: [0.25, 0.88, 1, 1],
  portalVisFill: [0.25, 0.88, 1, 0.18],
  pvsCurrent: [0.35, 0.86, 0.47, 1],
  pvsHidden: [0.16, 0.17, 0.19, 1],
  /** In the PVS but culled by runtime portal clipping. */
  pvsRuntimeCulled: [0.85, 0.5, 0.2, 1],
  surfaceNeutral: [0.62, 0.64, 0.68, 1],
  ray: [1, 1, 1, 0.16],
  leak: [1, 0.23, 0.23, 0.95],
  hover: [1, 1, 1, 0.55],
  selection: [1, 1, 1, 1],
} as const satisfies Record<string, Rgba>;

export const CSS_COLORS = {
  probe: "#ffffff",
  label: "rgba(255, 255, 255, 0.8)",
  portalLabel: "#ffd23f",
  handle: "#14161a",
  handleStroke: "#ffffff",
  handleHot: "#ffd23f",
  rayOk: "rgba(90, 220, 120, 0.9)",
  rayBad: "#ff3b3b",
} as const;

export function kindRgba(kind: BrushKind, alpha = 1): Rgba {
  return [...KIND_RGB[kind], alpha];
}

export function kindCss(kind: BrushKind): string {
  return KIND_HEX[kind];
}

/** Distinct, stable pastel colour per leaf index (golden-angle hue walk), as RGB 0..1. */
export function leafRgb(index: number): [number, number, number] {
  const h = leafHue(index) / 360;
  return hslToRgb(h, 0.45, 0.62);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
