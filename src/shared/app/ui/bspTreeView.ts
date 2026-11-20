/**
 * Floating BSP tree diagram shared by both editors: one row per depth, leaves
 * evenly spaced (front subtree on the left), edges coloured by node imbalance
 * (blue = even split → red = vine), a dashed line at the ideal depth
 * `log2(leaves)`. Hover a node / leaf to focus it (the scene views highlight
 * its region, splitter and front / back subtrees); click pins the focus.
 * Wheel zooms around the cursor (Shift: horizontal only), drag pans,
 * double-click refits.
 */

import {
  type BspBalance, type BspTree, type BspTreeLayout, type ChildRef, type Dim,
  bspBalance, bspTreeLayout, isLeafRef, refToLeaf,
} from "../../core";
import { heatRgb, rgbCss } from "../render/debugInfo";
import { BSP_BACK_RGB, BSP_FOCUS_RGB, BSP_FRONT_RGB } from "../render/palette";
import { h } from "./dom";

const MARGIN = 14;
const IMBALANCE_BUCKETS = 8;

/** Per-tree derived data: layout, balance and refs per depth row sorted by x (for picking). */
interface TreeData<D extends Dim> {
  readonly tree: BspTree<D>;
  readonly layout: BspTreeLayout;
  readonly balance: BspBalance;
  readonly rows: readonly ChildRef[][];
}

export class BspTreeView<D extends Dim> {
  /** Container element (positioned by the `.bsp-tree` CSS inside the stage). */
  readonly root: HTMLElement;
  private readonly info = h("div", { class: "bsp-tree-info" });
  private readonly canvas = h("canvas", {});
  private readonly ctx: CanvasRenderingContext2D;
  private data: TreeData<D> | null = null;
  private focus: ChildRef | null = null;
  private pinned = false;
  /** Screen x = ox + slot · sx, y = oy + depth · sy (CSS pixels). */
  private sx = 1; private sy = 1; private ox = 0; private oy = 0;
  private drag: { id: number; x: number; y: number; moved: boolean } | null = null;

  /**
   * `stage`: element the diagram floats in; `onFocus(ref)`: the focused ref changed
   * (hover or pin; null = none), the host should store it and re-render.
   */
  constructor(stage: HTMLElement, private readonly onFocus: (ref: ChildRef | null) => void) {
    this.root = h("div", { class: "bsp-tree", hidden: true }, this.info, this.canvas);
    stage.append(this.root);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    new ResizeObserver(() => { if (this.data) this.fit(); this.draw(); }).observe(this.canvas);
    this.bindInput();
  }

  /**
   * Shows (`tree` non-null and `visible`) or hides the diagram and redraws it when the tree
   * changed. A new tree resets the view and drops the focus (refs are per tree).
   */
  update(tree: BspTree<D> | null, visible: boolean): void {
    const show = visible && tree !== null;
    this.root.hidden = !show;
    if (!show) {
      if (this.focus !== null && !visible) this.setFocus(null, false);
      return;
    }
    if (this.data?.tree === tree) return;
    const layout = bspTreeLayout(tree);
    this.data = { tree, layout, balance: bspBalance(layout), rows: depthRows(tree, layout) };
    this.focus = null;
    this.pinned = false;
    this.onFocus(null);
    this.fit();
    this.draw();
  }

  // ---- View -------------------------------------------------------------------

  /** Fits the whole tree into the canvas. */
  private fit(): void {
    const d = this.data!;
    const w = this.canvas.clientWidth, hgt = this.canvas.clientHeight;
    this.sx = (w - 2 * MARGIN) / Math.max(1, d.layout.leafSlots - 1);
    this.sy = (hgt - 2 * MARGIN) / Math.max(1, d.layout.maxDepth);
    this.ox = d.layout.leafSlots > 1 ? MARGIN : w / 2;
    this.oy = MARGIN;
  }

  private setFocus(ref: ChildRef | null, pinned: boolean): void {
    this.pinned = pinned && ref !== null;
    if (ref !== this.focus) {
      this.focus = ref;
      this.onFocus(ref);
    }
    this.draw();
  }

  /** Screen position of a ref. */
  private pos(ref: ChildRef): [number, number] {
    const { layout } = this.data!;
    const leaf = isLeafRef(ref);
    const x = leaf ? layout.leafX[refToLeaf(ref)] : layout.nodeX[ref];
    const depth = leaf ? layout.leafDepth[refToLeaf(ref)] : layout.nodeDepth[ref];
    return [this.ox + x * this.sx, this.oy + depth * this.sy];
  }

  /** Ref nearest to screen point (x, y) within 10 px, or null. */
  private pick(x: number, y: number): ChildRef | null {
    const d = this.data;
    if (!d) return null;
    const row = d.rows[Math.round((y - this.oy) / this.sy)];
    if (!row || row.length === 0) return null;
    // Binary search the row (sorted by x) for the first item right of x, compare with its left neighbour.
    let lo = 0, hi = row.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pos(row[mid])[0] < x) lo = mid + 1; else hi = mid;
    }
    let best: ChildRef | null = null, bestSq = 100;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= row.length) continue;
      const [px, py] = this.pos(row[i]);
      const dsq = (px - x) * (px - x) + (py - y) * (py - y);
      if (dsq <= bestSq) { bestSq = dsq; best = row[i]; }
    }
    return best;
  }

  // ---- Drawing ----------------------------------------------------------------

  private draw(): void {
    const d = this.data;
    if (!d || this.root.hidden) return;
    const { ctx, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(hgt * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const { tree, layout } = d;

    // Ideal (balanced) depth guide.
    const yIdeal = this.oy + d.balance.idealDepth * this.sy;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yIdeal); ctx.lineTo(w, yIdeal); ctx.stroke();
    ctx.setLineDash([]);

    // Edges, batched by the parent's imbalance bucket.
    const buckets: Path2D[] = Array.from({ length: IMBALANCE_BUCKETS }, () => new Path2D());
    tree.nodes.forEach((n, id) => {
      if (layout.nodeDepth[id] < 0) return;
      const path = buckets[Math.min(IMBALANCE_BUCKETS - 1, Math.floor(layout.nodeImbalance[id] * IMBALANCE_BUCKETS))];
      const [x, y] = this.pos(id);
      for (const c of [n.front, n.back]) {
        const [cx, cy] = this.pos(c);
        path.moveTo(x, y); path.lineTo(cx, cy);
      }
    });
    ctx.lineWidth = 1;
    buckets.forEach((p, i) => { ctx.strokeStyle = rgbCss(heatRgb((i + 0.5) / IMBALANCE_BUCKETS), 0.75); ctx.stroke(p); });

    // Leaves: empty = light dots, solid = dark.
    const r = Math.max(1, Math.min(3, this.sx / 3));
    const empty = new Path2D(), solid = new Path2D();
    tree.leaves.forEach((leaf, i) => {
      if (layout.leafDepth[i] < 0) return;
      const [x, y] = this.pos(~i);
      (leaf.contents === "empty" ? empty : solid).rect(x - r, y - r, 2 * r, 2 * r);
    });
    ctx.fillStyle = "#9be39b"; ctx.fill(empty);
    ctx.fillStyle = "#555b66"; ctx.fill(solid);

    if (this.focus !== null) this.drawFocus(this.focus);
    this.info.textContent = this.describe();
  }

  /** Path to the root, then front / back subtrees of the focused ref in their colours. */
  private drawFocus(ref: ChildRef): void {
    const { ctx } = this;
    const { tree, layout } = this.data!;
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgbCss(BSP_FOCUS_RGB, 0.9);
    ctx.beginPath();
    let [x, y] = this.pos(ref);
    ctx.moveTo(x, y);
    for (let p = isLeafRef(ref) ? layout.leafParent[refToLeaf(ref)] : layout.nodeParent[ref]; p >= 0; p = layout.nodeParent[p]) {
      [x, y] = this.pos(p);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (!isLeafRef(ref)) {
      const n = tree.nodes[ref];
      this.strokeSubtree(ref, n.front, BSP_FRONT_RGB);
      this.strokeSubtree(ref, n.back, BSP_BACK_RGB);
    }
    [x, y] = this.pos(ref);
    ctx.fillStyle = rgbCss(BSP_FOCUS_RGB, 1);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }

  /** Strokes the edge parent → `ref` and the whole subtree under `ref`. */
  private strokeSubtree(parent: ChildRef, ref: ChildRef, rgb: readonly [number, number, number]): void {
    const { ctx } = this;
    const { tree } = this.data!;
    const path = new Path2D();
    const stack: [ChildRef, ChildRef][] = [[parent, ref]];
    while (stack.length > 0) {
      const [p, c] = stack.pop()!;
      const [px, py] = this.pos(p), [cx, cy] = this.pos(c);
      path.moveTo(px, py); path.lineTo(cx, cy);
      if (!isLeafRef(c)) stack.push([c, tree.nodes[c].front], [c, tree.nodes[c].back]);
    }
    ctx.strokeStyle = rgbCss(rgb, 0.95);
    ctx.lineWidth = 1.5;
    ctx.stroke(path);
  }

  /** Info line: balance stats, then the focused ref. */
  private describe(): string {
    const { tree, layout, balance: b } = this.data!;
    const f = (v: number) => v.toFixed(1);
    let s = `${b.nodeCount} nodes, ${b.leafCount} leaves · leaf depth min/mean/max ${b.minLeafDepth} / ${f(b.meanLeafDepth)} / ${b.maxDepth}` +
      ` · ideal ${f(b.idealDepth)} (dashed) · mean imbalance ${b.meanImbalance.toFixed(2)}`;
    const ref = this.focus;
    if (ref === null) return s + "\nHover: focus · click: pin · wheel: zoom (Shift: x only) · drag: pan · dbl-click: fit";
    if (isLeafRef(ref)) {
      const l = refToLeaf(ref);
      s += `\nLeaf L${l} (${tree.leaves[l].contents}) · depth ${layout.leafDepth[l]}`;
    } else {
      const n = tree.nodes[ref];
      const count = (c: ChildRef) => (isLeafRef(c) ? 1 : layout.nodeLeafCount[c]);
      s += `\nNode #${ref} · plane ${n.plane} · depth ${layout.nodeDepth[ref]} · leaves front ${count(n.front)} (cyan) / back ${count(n.back)} (orange)` +
        ` · imbalance ${layout.nodeImbalance[ref].toFixed(2)}`;
    }
    return s + (this.pinned ? " · pinned" : "");
  }

  // ---- Input ------------------------------------------------------------------

  private bindInput(): void {
    const c = this.canvas;
    const local = (e: MouseEvent): [number, number] => {
      const rect = c.getBoundingClientRect();
      return [e.clientX - rect.left, e.clientY - rect.top];
    };
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      const k = Math.exp(-e.deltaY * 0.0015);
      this.ox = x - (x - this.ox) * k;
      this.sx *= k;
      if (!e.shiftKey) { this.oy = y - (y - this.oy) * k; this.sy *= k; }
      this.draw();
    }, { passive: false });
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = local(e);
      this.drag = { id: e.pointerId, x, y, moved: false };
    });
    c.addEventListener("pointermove", (e) => {
      const [x, y] = local(e);
      const drag = this.drag;
      if (drag && drag.id === e.pointerId) {
        if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 3) drag.moved = true;
        if (drag.moved) {
          this.ox += x - drag.x; this.oy += y - drag.y;
          drag.x = x; drag.y = y;
          this.draw();
        }
        return;
      }
      if (!this.pinned) this.setFocus(this.pick(x, y), false);
    });
    c.addEventListener("pointerup", (e) => {
      const drag = this.drag;
      this.drag = null;
      if (!drag || drag.moved) return;
      const ref = this.pick(...local(e));
      // Click: pin what is under the cursor; clicking the pinned ref (or empty space) unpins.
      if (this.pinned && (ref === null || ref === this.focus)) this.setFocus(ref, false);
      else this.setFocus(ref, true);
    });
    c.addEventListener("pointerleave", () => { if (!this.pinned && !this.drag) this.setFocus(null, false); });
    c.addEventListener("dblclick", () => { if (this.data) { this.fit(); this.draw(); } });
  }
}

/** Refs of each depth row in increasing x (pre-order, front first, visits a row left to right). */
function depthRows<D extends Dim>(tree: BspTree<D>, layout: BspTreeLayout): ChildRef[][] {
  const rows: ChildRef[][] = Array.from({ length: layout.maxDepth + 1 }, () => []);
  const stack: ChildRef[] = [tree.root];
  while (stack.length > 0) {
    const r = stack.pop()!;
    if (isLeafRef(r)) { rows[layout.leafDepth[refToLeaf(r)]].push(r); continue; }
    rows[layout.nodeDepth[r]].push(r);
    stack.push(tree.nodes[r].back, tree.nodes[r].front);
  }
  return rows;
}
