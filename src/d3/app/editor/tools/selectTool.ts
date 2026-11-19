/**
 * Select / move / push-pull tool.
 *
 * - Click a brush to select it (the smallest brush pierced by the ray wins;
 *   clicking the selected brush again without dragging cycles to the next
 *   larger one, so rooms behind pillars stay reachable).
 * - Drag a brush to move it horizontally; hold Shift to move it vertically.
 * - Drag a face handle (square at a face centre) of the selected brush to push
 *   or pull that face along its normal; works for any convex brush.
 * - Delete/Backspace deletes, Ctrl+D duplicates, Esc deselects.
 */

import { type Brush, type Vec3, sub, windingCenter } from "../../../core";
import type { Overlay } from "../../render/overlay";
import { brushesAlongRay, faceHandleAt } from "../picking";
import { closestOnLine, rayPlane } from "../camera";
import type { Tool, ToolContext, ToolPointer } from "./tool";
import { CSS_COLORS } from "../../render/colors";

type Drag =
  | { kind: "move"; brush: Brush; anchor: Vec3; planeNormal: Vec3; vertical: boolean; moved: boolean; cycleTo: number | null }
  | { kind: "face"; brush: Brush; index: number; center: Vec3; normal: Vec3; t0: number };

const HANDLE_PX = 7;

export class SelectTool implements Tool {
  readonly id = "select" as const;
  readonly label = "Select";
  readonly shortcut = "v";
  readonly hint = "Click to select (again to cycle) · drag to move, Shift+drag vertical · drag face handles to push/pull · Del · Ctrl+D";
  readonly cursor = "default";

  private drag: Drag | null = null;
  private hoverId: number | null = null;
  private hoverFace = -1;

  constructor(private readonly ctx: ToolContext) {}

  deactivate(): void {
    this.drag = null;
    this.hoverId = null;
    this.hoverFace = -1;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const { model, camera } = this.ctx;
    const selected = model.selectedBrush;
    if (selected) {
      const index = faceHandleAt(camera, selected, p.screen, HANDLE_PX);
      if (index >= 0) {
        const face = selected.faces[index];
        const center = windingCenter(face.winding);
        const t0 = closestOnLine(p.ray, center, face.plane.n);
        if (t0 !== null) {
          model.beginGesture();
          this.drag = { kind: "face", brush: selected, index, center, normal: face.plane.n, t0 };
          return;
        }
      }
    }
    const hits = brushesAlongRay(model.level, p.ray);
    if (hits.length === 0) {
      model.select(null);
      return;
    }
    // Keep the selection if it is under the cursor (so it can be dragged); a click without drag cycles.
    const current = hits.findIndex((h) => h.brush.id === model.selectedId);
    const hit = current >= 0 ? hits[current] : hits[0];
    const cycleTo = current >= 0 && hits.length > 1 ? hits[(current + 1) % hits.length].brush.id : null;
    model.select(hit.brush.id);
    const vertical = p.shift;
    const { forward } = camera.basis();
    // Horizontal moves slide on a horizontal plane through the grab point; vertical ones on a camera-facing vertical plane.
    const planeNormal = vertical ? normalizeXY(forward) : { x: 0, y: 0, z: 1 };
    model.beginGesture();
    this.drag = { kind: "move", brush: hit.brush, anchor: hit.point, planeNormal, vertical, moved: false, cycleTo };
  }

  pointerMove(p: ToolPointer): void {
    const { model, view, camera } = this.ctx;
    if (!this.drag) {
      const sel = model.selectedBrush;
      const face = sel ? faceHandleAt(camera, sel, p.screen, HANDLE_PX) : -1;
      const id = face >= 0 ? sel!.id : brushesAlongRay(model.level, p.ray)[0]?.brush.id ?? null;
      if (id !== this.hoverId || face !== this.hoverFace) {
        this.hoverId = id;
        this.hoverFace = face;
        this.ctx.requestRender();
      }
      return;
    }
    if (this.drag.kind === "move") {
      const d = this.drag;
      const cur = rayPlane(p.ray, d.anchor, d.planeNormal);
      if (!cur) return;
      const raw = sub(cur, d.anchor);
      const delta = d.vertical ? { x: 0, y: 0, z: view.snapValue(raw.z) } : { x: view.snapValue(raw.x), y: view.snapValue(raw.y), z: 0 };
      if (delta.x !== 0 || delta.y !== 0 || delta.z !== 0) d.moved = true;
      model.translateBrush(d.brush.id, d.brush, delta);
    } else {
      const d = this.drag;
      const t = closestOnLine(p.ray, d.center, d.normal);
      if (t === null) return;
      model.moveFace(d.brush.id, d.brush, d.index, view.snapValue(t - d.t0));
    }
  }

  pointerUp(): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    this.ctx.model.endGesture();
    if (d.kind === "move" && !d.moved && d.cycleTo !== null) this.ctx.model.select(d.cycleTo);
  }

  keyDown(e: KeyboardEvent): boolean {
    const { model, view } = this.ctx;
    const id = model.selectedId;
    if (id === null) return false;
    if (e.key === "Delete" || e.key === "Backspace") {
      model.removeBrush(id);
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      const g = view.gridSize > 0 ? view.gridSize : 1;
      model.duplicateBrush(id, { x: g, y: -g, z: 0 });
      return true;
    }
    if (e.key === "Escape") {
      model.select(null);
      return true;
    }
    return false;
  }

  drawOverlay(o: Overlay): void {
    const { model } = this.ctx;
    const hover = model.level.brushes.find((b) => b.id === this.hoverId);
    if (hover && hover.id !== model.selectedId) for (const f of hover.faces) o.loop(f.winding, { color: "rgba(255,255,255,0.55)", width: 1.5 });
    const sel = model.selectedBrush;
    if (!sel) return;
    const activeFace = this.drag?.kind === "face" ? this.drag.index : this.hoverFace;
    sel.faces.forEach((f, i) => {
      const hot = i === activeFace;
      if (hot) o.loop(f.winding, { color: CSS_COLORS.handleHot, width: 2.5 });
      o.square(windingCenter(f.winding), hot ? 5 : 4, hot ? CSS_COLORS.handleHot : CSS_COLORS.handle, { color: CSS_COLORS.handleStroke, width: 1.5 });
    });
  }
}

/** Horizontal part of a direction, normalized (falls back to +x). */
function normalizeXY(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len > 1e-6 ? { x: v.x / len, y: v.y / len, z: 0 } : { x: 1, y: 0, z: 0 };
}

