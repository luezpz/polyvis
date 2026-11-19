/** Terse helpers for writing 3D levels in code (samples, demos, tests). Not re-exported by the barrel. Z is up. */

import { type Brush, type BrushKind, type Point2, makeBoxBrush, makeBrush, makePrismBrush, withFlags } from "./brush";
import { type Level, LEVEL_FORMAT, LEVEL_VERSION } from "./level";
import type { Plane3 } from "../math";

/**
 * A brush as an axis box `[x0, y0, z0, x1, y1, z1]`, a vertical prism over a footprint, or outward planes;
 * `detail` marks a non-cutting solid, `door` a door volume (phase 4b), `faceSplitBias` per-face BSP splitter
 * bias (phase 3d) in face order: box −x, +x, −y, +y, −z, +z; prism bottom, top, then footprint hull edges;
 * planes: their order.
 */
type SpecFlags = { detail?: boolean; door?: string; faceSplitBias?: number[] };
export type BrushSpec =
  | ({ kind: BrushKind; box: [number, number, number, number, number, number] } & SpecFlags)
  | ({ kind: BrushKind; prism: Point2[]; z0: number; z1: number } & SpecFlags)
  | ({ kind: BrushKind; planes: Plane3[] } & SpecFlags);

/** Builds a level from specs; ids are 1-based spec order, degenerate specs are dropped. */
export function build(specs: readonly BrushSpec[]): Level {
  const brushes: Brush[] = [];
  specs.forEach((s, i) => {
    const id = i + 1;
    const b = "box" in s
      ? makeBoxBrush(id, s.kind, { x: s.box[0], y: s.box[1], z: s.box[2] }, { x: s.box[3], y: s.box[4], z: s.box[5] })
      : "prism" in s
        ? makePrismBrush(id, s.kind, s.prism, s.z0, s.z1)
        : makeBrush(id, s.kind, s.planes);
    if (b) brushes.push(withFlags(b, { detail: s.detail, door: s.door, faceSplitBias: s.faceSplitBias, planes: "planes" in s ? s.planes : undefined }));
  });
  return { format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes, meshes: [] };
}

/** Room / solid box spanning the two corners. */
export const room = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BrushSpec => ({ kind: "room", box: [x0, y0, z0, x1, y1, z1] });
export const solid = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BrushSpec => ({ kind: "solid", box: [x0, y0, z0, x1, y1, z1] });

/** Regular polygon footprint helper. */
export function ngon(cx: number, cy: number, r: number, sides: number, phase = 0): Point2[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * Math.PI * 2;
    return { x: Math.round((cx + Math.cos(a) * r) * 1000) / 1000, y: Math.round((cy + Math.sin(a) * r) * 1000) / 1000 };
  });
}

/**
 * Solid ramp rising along +y from height 0 at `y0` to `h` at `y1`, between `x0` and `x1`, standing on `z`.
 * Built from planes because it is not a vertical prism.
 */
export function ramp(x0: number, x1: number, y0: number, y1: number, z: number, h: number): BrushSpec {
  const slope = { x: 0, y: -h, z: y1 - y0 }; // outward normal of the sloped top (not unit)
  return {
    kind: "solid",
    planes: [
      { n: { x: 0, y: 0, z: -1 }, d: -z },
      { n: { x: -1, y: 0, z: 0 }, d: -x0 },
      { n: { x: 1, y: 0, z: 0 }, d: x1 },
      { n: { x: 0, y: 1, z: 0 }, d: y1 },
      { n: slope, d: slope.y * y0 + slope.z * z },
    ],
  };
}
