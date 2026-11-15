/**
 * Polygon tool: click points on the work plane, then Enter / double-click /
 * click the first point to create a convex prism brush (the convex hull of the
 * clicked points, extruded by the "new brush height").
 */

import { type Vec3, convexHull2, distance } from "../../../core";
import type { Overlay } from "../../render/overlay";
import type { Tool, ToolContext, ToolPointer } from "./tool";
import { kindCss } from "../../render/colors";

const CLOSE_PX = 9;

export class PolygonTool implements Tool {
  readonly id = "polygon" as const;
  readonly label = "Polygon";
  readonly shortcut = "p";
  readonly hint = "Click points on the work plane · Enter/double-click/first point to finish · Backspace undo point · Esc cancel";
  readonly cursor = "crosshair";

  private points: Vec3[] = [];
  private cursorPoint: Vec3 | null = null;

  constructor(private readonly ctx: ToolContext) {}

  deactivate(): void {
    this.points = [];
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.workSnapped) return;
    const first = this.points[0];
    if (first && this.points.length >= 3) {
      const s = this.ctx.camera.project(first);
      if (s && Math.hypot(s.x - p.screen.x, s.y - p.screen.y) <= CLOSE_PX) {
        this.finish();
        return;
      }
    }
    const last = this.points[this.points.length - 1];
    if (!last || distance(last, p.workSnapped) > 1e-9) this.points.push(p.workSnapped);
    this.ctx.requestRender();
  }

  pointerMove(p: ToolPointer): void {
    this.cursorPoint = p.workSnapped;
    this.ctx.requestRender();
  }

  doubleClick(): void {
    this.finish();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === "Enter") {
      this.finish();
      return true;
    }
    if (e.key === "Escape" && this.points.length) {
      this.points = [];
      this.ctx.requestRender();
      return true;
    }
    if (e.key === "Backspace" && this.points.length) {
      this.points.pop();
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  private finish(): void {
    const { view, model } = this.ctx;
    if (this.points.length >= 3) model.addPrism(model.newBrushKind, this.points, view.workZ, view.workZ + view.brushHeight);
    this.points = [];
    this.ctx.requestRender();
  }

  drawOverlay(o: Overlay): void {
    const color = kindCss(this.ctx.model.newBrushKind);
    const z0 = this.ctx.view.workZ, z1 = z0 + this.ctx.view.brushHeight;
    const pts = this.cursorPoint ? [...this.points, this.cursorPoint] : this.points;
    if (pts.length >= 3) {
      const hull = convexHull2(pts);
      o.loop(hull.map((p) => ({ x: p.x, y: p.y, z: z0 })), { color, width: 1, dash: [5, 4] });
      o.loop(hull.map((p) => ({ x: p.x, y: p.y, z: z1 })), { color, width: 1, dash: [5, 4] });
    }
    for (let i = 0; i + 1 < pts.length; i++) o.line(pts[i], pts[i + 1], { color, width: 1.5 });
    this.points.forEach((p, i) => o.dot(p, i === 0 ? 5 : 3, color));
  }
}
