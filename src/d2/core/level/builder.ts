/** Terse helpers for writing levels in code (samples, demos, tests). Not re-exported by the barrel. */

import { type Brush, type BrushKind, type Level, LEVEL_FORMAT, LEVEL_VERSION, makeBoxBrush, makeBrush, withFlags } from "./level";
import type { Vec2 } from "../math";

/** A brush as an axis box `[x0, y0, x1, y1]` or as the convex hull of `points`; `detail` marks a non-cutting solid, `door` a door volume (phase 4b). */
export type BrushSpec =
  | { kind: BrushKind; box: [number, number, number, number]; detail?: boolean; door?: string }
  | { kind: BrushKind; points: Vec2[]; detail?: boolean; door?: string };

/** Builds a level from specs; ids are 1-based spec order, degenerate specs are dropped. */
export function build(specs: readonly BrushSpec[]): Level {
  const brushes: Brush[] = [];
  specs.forEach((s, i) => {
    const b = "box" in s
      ? makeBoxBrush(i + 1, s.kind, { x: s.box[0], y: s.box[1] }, { x: s.box[2], y: s.box[3] })
      : makeBrush(i + 1, s.kind, s.points);
    if (b) brushes.push(withFlags(b, s));
  });
  return { format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes };
}

/** Regular polygon (centre, radius, side count, start angle in radians), rounded to 1e-3. */
export function ngon(cx: number, cy: number, r: number, sides: number, phase = 0): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * Math.PI * 2;
    return { x: Math.round((cx + Math.cos(a) * r) * 1000) / 1000, y: Math.round((cy + Math.sin(a) * r) * 1000) / 1000 };
  });
}

/** Room / solid box spanning (x0, y0)–(x1, y1). */
export const room = (x0: number, y0: number, x1: number, y1: number): BrushSpec => ({ kind: "room", box: [x0, y0, x1, y1] });
export const solid = (x0: number, y0: number, x1: number, y1: number): BrushSpec => ({ kind: "solid", box: [x0, y0, x1, y1] });
