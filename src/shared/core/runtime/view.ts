/**
 * A camera for runtime portal clipping (phase 4), in both dimensions.
 *
 * Screen coordinates of a point p, one per screen axis a_k (2D: 1 axis, 3D: 2 axes):
 *   s_k(p) = a_k·(p − eye) / f·(p − eye)        (f = forward; depth z = f·(p − eye))
 * i.e. a pinhole projection onto the plane at unit depth. The view is the box
 * `rect.min[k] ≤ s_k ≤ rect.max[k]` (tangents of the half field of view) in front of the eye.
 * Both clip modes use the same camera, so "rect" (cheap, looser) can be compared with "planes".
 */

import type { Dim, Geometry, Plane, Vec } from "../geometry";

/** Screen-space rectangle, `dimension − 1` axes (tangent units: s = lateral / depth). */
export interface ScreenRect {
  readonly min: readonly number[];
  readonly max: readonly number[];
}

export interface View<D extends Dim> {
  /** Unit view direction. */
  readonly forward: Vec<D>;
  /** Unit screen axes orthogonal to `forward` (2D: one, 3D: right and up). */
  readonly axes: readonly Vec<D>[];
  /** Visible screen rectangle; default ±1 on every axis (90° field of view). */
  readonly rect?: ScreenRect;
}

/** The default 90° screen rectangle for `axes` screen axes. */
export const fullRect = (axes: number): ScreenRect => ({ min: Array(axes).fill(-1), max: Array(axes).fill(1) });

/**
 * The view's side planes (front = inside), for the "planes" clip mode. For bound h on axis a the
 * condition s ≤ h is h·f·(p − e) − a·(p − e) ≥ 0: plane normal n ∝ h·f − a through the eye
 * (s ≥ l gives n ∝ a − l·f). No near plane: side planes already exclude everything behind the eye
 * except the apex.
 */
export function viewFrustum<D extends Dim>(g: Geometry<D>, eye: Vec<D>, view: View<D>): Plane<D>[] {
  const rect = view.rect ?? fullRect(view.axes.length);
  const f = g.coords(view.forward);
  const out: Plane<D>[] = [];
  const plane = (c: number[]): void => {
    const len = Math.hypot(...c);
    const n = g.vecAt(c.map((x) => x / len), 0);
    out.push({ n, d: g.dot(n, eye) });
  };
  view.axes.forEach((axis, k) => {
    const a = g.coords(axis);
    plane(f.map((fi, i) => rect.max[k] * fi - a[i]));
    plane(f.map((fi, i) => a[i] - rect.min[k] * fi));
  });
  return out;
}

/**
 * Screen rectangle covering `points` as seen from `eye` ("rect" mode: Doom 3 narrows a screen
 * rect per portal). Null if every point is behind the eye (depth ≤ 0, not visible); `"all"` if the
 * points straddle the eye plane (projection unbounded: keep the current rect, conservative).
 */
export function projectRect<D extends Dim>(g: Geometry<D>, eye: Vec<D>, view: View<D>, points: readonly Vec<D>[]): ScreenRect | null | "all" {
  const { dot } = g;
  const k = view.axes.length;
  const fe = dot(view.forward, eye);
  const ae = view.axes.map((a) => dot(a, eye));
  const min = Array<number>(k).fill(Infinity), max = Array<number>(k).fill(-Infinity);
  let behind = 0;
  for (const p of points) {
    const z = dot(view.forward, p) - fe;
    if (z <= 1e-9) { behind++; continue; }
    for (let i = 0; i < k; i++) {
      const s = (dot(view.axes[i], p) - ae[i]) / z;
      if (s < min[i]) min[i] = s;
      if (s > max[i]) max[i] = s;
    }
  }
  if (behind === points.length) return null;
  return behind > 0 ? "all" : { min, max };
}

/** `a ∩ b`, or null if empty (touching counts as non-empty: conservative). */
export function intersectRects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const min = a.min.map((x, i) => Math.max(x, b.min[i]));
  const max = a.max.map((x, i) => Math.min(x, b.max[i]));
  return min.every((x, i) => x <= max[i]) ? { min, max } : null;
}

/**
 * The 2·dimension axis-aligned 90° views (a cube map: ±x, ±y[, ±z]); together they cover every
 * direction, so "rect" mode can run omnidirectionally as the union over them.
 */
export function axisViews<D extends Dim>(g: Geometry<D>): View<D>[] {
  const dim = g.dimension;
  const unit = (k: number, s: number) => g.vecAt(Array.from({ length: dim }, (_, i) => (i === k ? s : 0)), 0);
  const out: View<D>[] = [];
  for (let k = 0; k < dim; k++) {
    for (const s of [1, -1]) {
      out.push({ forward: unit(k, s), axes: Array.from({ length: dim }, (_, i) => i).filter((i) => i !== k).map((i) => unit(i, 1)) });
    }
  }
  return out;
}
