/** Hit-testing helpers for the editor (rays against brushes, surfaces, portals). */

import {
  type Brush, type CompileResult, type Level, type Plane3, type Vec3, type Winding,
  addScaled, brushVolume, dot, rayWinding, windingCenter, windingPlane,
} from "../../core";
import type { Camera, Ray, ScreenPoint } from "./camera";

/** Entry/exit parameters of a ray through a convex brush (slab test over its planes), or null. */
export function rayBrush(ray: Ray, brush: Brush): { tIn: number; tOut: number } | null {
  let tIn = -Infinity, tOut = Infinity;
  for (const p of brush.planes) {
    const denom = dot(p.n, ray.dir);
    const dist = dot(p.n, ray.origin) - p.d;
    if (Math.abs(denom) < 1e-12) {
      if (dist > 0) return null;
      continue;
    }
    const t = -dist / denom;
    if (denom < 0) tIn = Math.max(tIn, t);
    else tOut = Math.min(tOut, t);
    if (tIn > tOut) return null;
  }
  return tOut >= 0 ? { tIn, tOut } : null;
}

export interface BrushHit {
  readonly brush: Brush;
  /** First point where the ray touches the brush (or the ray origin if it starts inside). */
  readonly point: Vec3;
}

/**
 * Brushes pierced by the ray, smallest volume first (small brushes inside big
 * rooms stay clickable, like the 2D editor's "smallest brush under cursor").
 */
export function brushesAlongRay(level: Level, ray: Ray): BrushHit[] {
  const hits: { brush: Brush; point: Vec3; volume: number }[] = [];
  for (const brush of level.brushes) {
    const h = rayBrush(ray, brush);
    if (!h) continue;
    hits.push({ brush, point: addScaled(ray.origin, ray.dir, Math.max(0, h.tIn)), volume: brushVolume(brush) });
  }
  return hits.sort((a, b) => a.volume - b.volume);
}

/** Index of the face of `brush` whose handle (face centre) is within `radiusPx` of `screen`, or -1. */
export function faceHandleAt(camera: Camera, brush: Brush, screen: ScreenPoint, radiusPx: number): number {
  let best = -1;
  let bestScore = Infinity;
  brush.faces.forEach((f, i) => {
    const s = camera.project(windingCenter(f.winding));
    if (!s) return;
    const d = Math.hypot(s.x - screen.x, s.y - screen.y);
    // Prefer the nearer handle when several overlap on screen.
    const score = d + s.depth * 1e-3;
    if (d <= radiusPx && score < bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

/** A leaf surface prepared for ray casts. */
export interface PickSurface {
  readonly leaf: number;
  readonly winding: Winding;
  readonly plane: Plane3;
}

const surfaceCache = new WeakMap<CompileResult, PickSurface[]>();

export function pickSurfaces(result: CompileResult): PickSurface[] {
  let list = surfaceCache.get(result);
  if (!list) {
    list = [];
    result.surfaces.forEach((surfs, leaf) => {
      for (const s of surfs) {
        const plane = windingPlane(s.winding);
        if (plane) list!.push({ leaf, winding: s.winding, plane });
      }
    });
    surfaceCache.set(result, list);
  }
  return list;
}

export interface SurfaceHit {
  readonly t: number;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly leaf: number;
}

/**
 * Nearest *front-facing* leaf surface along the ray (the ones the renderer
 * draws; back faces are culled so you can look into rooms from outside).
 */
export function surfaceAlongRay(result: CompileResult, ray: Ray): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  for (const s of pickSurfaces(result)) {
    if (dot(s.plane.n, ray.dir) >= 0) continue;
    const t = rayWinding(ray.origin, ray.dir, s.winding, s.plane, best?.t ?? Infinity);
    if (t !== null && (!best || t < best.t)) best = { t, point: addScaled(ray.origin, ray.dir, t), normal: s.plane.n, leaf: s.leaf };
  }
  return best;
}

/** Nearest portal along the ray (closer than `maxT`), choosing the twin we look through (from → to). */
export function portalAlongRay(result: CompileResult, ray: Ray, maxT = Infinity): number | null {
  let best: number | null = null;
  let bestT = maxT;
  for (const p of result.graph.portals) {
    if (dot(p.plane.n, ray.dir) <= 0) continue;
    const t = rayWinding(ray.origin, ray.dir, p.winding, p.plane, bestT);
    if (t !== null && t < bestT) {
      best = p.id;
      bestT = t;
    }
  }
  return best;
}
