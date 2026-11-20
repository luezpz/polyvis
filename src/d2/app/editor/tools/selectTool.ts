/**
 * Select / move / edit tool.
 *
 * - Click a brush to select it (the smallest brush under the cursor wins;
 *   clicking the selected brush again without dragging cycles to the next
 *   larger one, so rooms under pillars stay reachable, as in 3D).
 * - Drag a brush to move it.
 * - Drag a vertex handle (dot) of the selected brush to reshape it (re-hulled,
 *   so it stays convex); drag an edge handle (square at an edge midpoint) to
 *   push/pull that edge along its normal (3D face push/pull analogue). Clicking
 *   an edge handle also selects that edge (its split bias is edited in the panel).
 * - Delete/Backspace deletes, Ctrl+D duplicates, Esc deselects (edge first).
 */

import { type Brush, type Vec2, dot, lineFromPoints, midpoint, sub } from "../../../core";
import type { Painter } from "../../render/painter";
import { brushesAt, edgeHandleAt, vertexAt } from "../picking";
import type { Tool, ToolContext, ToolPointer } from "./tool";
import { COLORS } from "../../render/colors";

type Drag =
  | { kind: "move"; brush: Brush; start: Vec2; moved: boolean; cycleTo: number | null }
  | { kind: "vertex"; brush: Brush; index: number }
  | { kind: "edge"; brush: Brush; index: number; start: Vec2; outward: Vec2 };

const HANDLE_PX = 7;

export class SelectTool implements Tool {
  readonly id = "select" as const;
  readonly label = "Select";
  readonly shortcut = "v";
  readonly hint = "Click to select (again to cycle) · drag to move · drag dots to reshape, squares to select / push/pull edges · Del · Ctrl+D";
  readonly cursor = "default";

  private drag: Drag | null = null;
  private hoverId: number | null = null;
  private hoverEdge = -1;

  constructor(private readonly ctx: ToolContext) {}

  deactivate(): void {
    this.drag = null;
    this.hoverId = null;
    this.hoverEdge = -1;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const { model, camera } = this.ctx;
    const selected = model.selectedBrush;
    if (selected) {
      const vi = vertexAt(selected, p.world, camera.pixels(HANDLE_PX));
      if (vi >= 0) {
        model.beginGesture();
        this.drag = { kind: "vertex", brush: selected, index: vi };
        return;
      }
      const ei = edgeHandleAt(selected, p.world, camera.pixels(HANDLE_PX));
      const outward = ei >= 0 ? edgeOutward(selected, ei) : null;
      if (outward) {
        model.selectFace(ei);
        model.beginGesture();
        this.drag = { kind: "edge", brush: selected, index: ei, start: p.world, outward };
        return;
      }
    }
    const hits = brushesAt(model.level, p.world);
    if (hits.length === 0) {
      model.select(null);
      return;
    }
    // Keep the selection if it is under the cursor (so it can be dragged); a click without drag cycles.
    const current = hits.findIndex((b) => b.id === model.selectedId);
    const hit = current >= 0 ? hits[current] : hits[0];
    const cycleTo = current >= 0 && hits.length > 1 ? hits[(current + 1) % hits.length].id : null;
    model.select(hit.id);
    model.beginGesture();
    this.drag = { kind: "move", brush: hit, start: p.snapped, moved: false, cycleTo };
  }

  pointerMove(p: ToolPointer): void {
    const { model, view, camera } = this.ctx;
    if (!this.drag) {
      const sel = model.selectedBrush;
      const edge = sel && vertexAt(sel, p.world, camera.pixels(HANDLE_PX)) < 0 ? edgeHandleAt(sel, p.world, camera.pixels(HANDLE_PX)) : -1;
      const id = edge >= 0 ? sel!.id : brushesAt(model.level, p.world)[0]?.id ?? null;
      if (id !== this.hoverId || edge !== this.hoverEdge) {
        this.hoverId = id;
        this.hoverEdge = edge;
        this.ctx.requestRender();
      }
      return;
    }
    const d = this.drag;
    if (d.kind === "move") {
      const delta = sub(p.snapped, d.start);
      if (delta.x !== 0 || delta.y !== 0) d.moved = true;
      model.translateBrush(d.brush.id, d.brush, delta);
    } else if (d.kind === "vertex") {
      const vertices = d.brush.vertices.map((v, i) => (i === d.index ? p.snapped : v));
      model.updateBrush(d.brush.id, { vertices });
    } else {
      model.moveEdge(d.brush.id, d.brush, d.index, view.snapValue(dot(sub(p.world, d.start), d.outward)));
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
      model.duplicateBrush(id, { x: g, y: -g });
      return true;
    }
    if (e.key === "Escape") {
      if (model.selectedFace >= 0) model.selectFace(-1);
      else model.select(null);
      return true;
    }
    return false;
  }

  drawOverlay(painter: Painter): void {
    const { model } = this.ctx;
    const hover = model.level.brushes.find((b) => b.id === this.hoverId);
    if (hover && hover.id !== model.selectedId) painter.polygon(hover.vertices, null, { color: COLORS.hover, width: 2 });
    const sel = model.selectedBrush;
    if (!sel) return;
    const vs = sel.vertices;
    // The dragged brush is re-hulled every move, so edge indices are only stable on the original.
    const activeEdge = this.drag?.kind === "edge" ? -1 : this.hoverEdge;
    const picked = this.drag ? -1 : model.selectedFace;
    vs.forEach((a, i) => {
      const b = vs[(i + 1) % vs.length];
      const hot = i === activeEdge;
      if (hot) painter.line(a, b, { color: COLORS.handleHot, width: 2.5 });
      else if (i === picked) painter.line(a, b, { color: COLORS.faceSelected, width: 2.5 });
      else if ((sel.faceSplitBias?.[i] ?? 0) !== 0) painter.line(a, b, { color: COLORS.hintFace, width: 2 });
      painter.square(midpoint(a, b), hot ? 5 : 4, hot ? COLORS.handleHot : COLORS.handleFill, { color: COLORS.selection, width: 1.5 });
    });
    for (const v of vs) painter.dot(v, 4, COLORS.handleFill, { color: COLORS.selection, width: 1.5 });
  }
}

/** Outward unit normal of edge `index` of a CCW brush (null for a zero-length edge). */
function edgeOutward(brush: Brush, index: number): Vec2 | null {
  const vs = brush.vertices;
  const line = lineFromPoints(vs[index], vs[(index + 1) % vs.length]);
  return line ? { x: -line.n.x, y: -line.n.y } : null;
}
