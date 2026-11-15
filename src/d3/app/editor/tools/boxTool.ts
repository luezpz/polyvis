/**
 * Box tool: drag a rectangle on the work plane to create a box brush of the
 * current "new brush height" (room or solid).
 */

import type { Vec3 } from "../../../core";
import type { Overlay } from "../../render/overlay";
import type { Tool, ToolContext, ToolPointer } from "./tool";
import { kindCss } from "../../render/colors";

export class BoxTool implements Tool {
  readonly id = "box" as const;
  readonly label = "Box";
  readonly shortcut = "b";
  readonly hint = "Drag on the work plane to create a box · height from the panel · [ ] move the work plane · K room/solid";
  readonly cursor = "crosshair";

  private start: Vec3 | null = null;
  private current: Vec3 | null = null;

  constructor(private readonly ctx: ToolContext) {}

  deactivate(): void {
    this.start = this.current = null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.workSnapped) return;
    this.start = this.current = p.workSnapped;
  }

  pointerMove(p: ToolPointer): void {
    if (p.workSnapped) this.current = p.workSnapped;
    this.ctx.requestRender();
  }

  pointerUp(): void {
    if (!this.start || !this.current) return;
    const a = this.start, b = this.current;
    this.start = null;
    const { view, model } = this.ctx;
    if (Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6 && Math.abs(view.brushHeight) > 1e-6) {
      model.addBox(model.newBrushKind, { x: a.x, y: a.y, z: view.workZ }, { x: b.x, y: b.y, z: view.workZ + view.brushHeight });
    }
    this.ctx.requestRender();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.start) {
      this.start = null;
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  drawOverlay(o: Overlay): void {
    const color = kindCss(this.ctx.model.newBrushKind);
    if (this.current && !this.start) o.dot(this.current, 3, color);
    if (!this.start || !this.current) return;
    const z0 = this.ctx.view.workZ, z1 = z0 + this.ctx.view.brushHeight;
    const a = this.start, b = this.current;
    const corners = (z: number): Vec3[] => [{ x: a.x, y: a.y, z }, { x: b.x, y: a.y, z }, { x: b.x, y: b.y, z }, { x: a.x, y: b.y, z }];
    const bottom = corners(z0), top = corners(z1);
    o.loop(bottom, { color, width: 2 });
    o.loop(top, { color, width: 1, dash: [5, 4] });
    bottom.forEach((p, i) => o.line(p, top[i], { color, width: 1, dash: [5, 4] }));
    const w = Math.abs(b.x - a.x), d = Math.abs(b.y - a.y), h = Math.abs(z1 - z0);
    o.text({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: z1 }, `${+w.toFixed(3)} × ${+d.toFixed(3)} × ${+h.toFixed(3)}`, color, 11);
  }
}
