/**
 * Draws the editor scene: grid, compiled BSP/portal/PVS debug layers, brushes
 * and the active tool's overlay. Stateless apart from the canvas it owns; all
 * inputs are passed to {@link Renderer.draw}.
 */

import {
  type CompileResult, type Level, type Vec2,
  type BitSet, centroid, locateLeaf, midpoint, splitterSegments, visibilityPolygon, addScaled, visibleLeaves, doorPortalOpen,
  isLeafRef, leavesUnder, refToLeaf,
} from "../../core";
import type { Camera } from "../editor/camera";
import type { ViewState } from "../editor/viewState";
import type { Tool } from "../editor/tools/tool";
import { type DebugInfo, PORTAL_KIND_RGB, debugInfo, groupRgb, heatRgb, rgbCss } from "../../../shared/app/render/debugInfo";
import { BSP_BACK_RGB, BSP_FOCUS_RGB, BSP_FRONT_RGB } from "../../../shared/app/render/palette";
import { Painter } from "./painter";
import { COLORS, kindColors, leafColor } from "./colors";

export interface SceneInput {
  readonly level: Level;
  readonly selectedId: number | null;
  readonly compiled: CompileResult | null;
  readonly view: ViewState;
  readonly tool: Tool;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly painter: Painter;
  /** Splitter segments are cached per compile result. */
  private splitterCache: { result: CompileResult; segments: ReturnType<typeof splitterSegments> } | null = null;
  private runtimeCache: { result: CompileResult; x: number; y: number; clip: string; shut: boolean; value: BitSet } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly camera: Camera) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.painter = new Painter(ctx, camera);
  }

  /** Matches the backing store to the element size and device pixel ratio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.camera.resize(w, h);
  }

  draw(scene: SceneInput): void {
    const { ctx, camera } = this;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, camera.width, camera.height);

    const { layers } = scene.view;
    const result = scene.compiled;
    if (layers.grid) this.drawGrid(scene.view.gridSize);
    if (result && layers.leaves) this.drawLeaves(result);
    if (result && layers.clusters) this.drawLeafFill(result, (leaf, info) => rgbCss(groupRgb(info.leafGroup[leaf]), 0.4));
    if (result && layers.pvsHeat) this.drawLeafFill(result, (leaf, info) => rgbCss(heatRgb(info.pvsHeat[leaf]), 0.45));
    if (result && layers.bspDepth) {
      const maxDepth = result.tree.leaves.reduce((m, l) => Math.max(m, l.depth), 1);
      this.drawLeafFill(result, (leaf) => rgbCss(heatRgb(result.tree.leaves[leaf].depth / maxDepth), 0.45));
    }
    if (result && layers.pvs) this.drawPvs(result, scene.view);
    if (result && layers.lineOfSight) this.drawLineOfSight(result, scene.view);
    if (layers.brushes) this.drawBrushes(scene.level, scene.selectedId);
    if (result && layers.splitters) this.drawSplitters(result, layers.labels);
    if (result && layers.walls) this.drawWalls(result);
    if (result && layers.surfaces) this.drawSurfaces(result, scene.view);
    if (result && layers.portals) this.drawPortals(result, scene.view);
    if (result && layers.portalGraph) this.drawPortalGraph(result);
    if (result && layers.labels) this.drawLabels(result);
    if (result?.leaks.leaking) this.drawLeaks(result);
    if (result && layers.bspTree && scene.view.bspFocus !== null) this.drawBspFocus(result, scene.view.bspFocus);
    if (scene.view.inspect.point && scene.tool.id === "inspect") {
      this.painter.dot(scene.view.inspect.point, scene.view.inspect.pinned ? 5 : 3.5, COLORS.probe, { color: "#000", width: 1 });
    }
    scene.tool.drawOverlay?.(this.painter);
  }

  private drawGrid(step: number): void {
    const { camera, painter } = this;
    const g = step > 0 ? step : 1;
    // Skip minor lines when they would be closer than 6px.
    let minor = g;
    while (minor * camera.zoom < 6) minor *= 2;
    const major = minor * 8;
    const vb = camera.visibleBounds();
    const lines = (spacing: number, color: string) => {
      for (let x = Math.floor(vb.min.x / spacing) * spacing; x <= vb.max.x; x += spacing)
        painter.line({ x, y: vb.min.y }, { x, y: vb.max.y }, { color });
      for (let y = Math.floor(vb.min.y / spacing) * spacing; y <= vb.max.y; y += spacing)
        painter.line({ x: vb.min.x, y }, { x: vb.max.x, y }, { color });
    };
    lines(minor, COLORS.gridMinor);
    lines(major, COLORS.gridMajor);
    painter.line({ x: 0, y: vb.min.y }, { x: 0, y: vb.max.y }, { color: COLORS.axis });
    painter.line({ x: vb.min.x, y: 0 }, { x: vb.max.x, y: 0 }, { color: COLORS.axis });
  }

  private drawLeaves(result: CompileResult): void {
    result.tree.leaves.forEach((leaf, i) => {
      if (leaf.contents !== "empty" || !leaf.region) return;
      this.painter.polygon(leaf.region.vertices, leafColor(i), { color: COLORS.leafStroke, width: 1 });
    });
  }

  /** Fills every empty leaf with `color(leaf, info)` (cluster / heat layers). */
  private drawLeafFill(result: CompileResult, color: (leaf: number, info: DebugInfo) => string): void {
    const info = debugInfo(result);
    result.tree.leaves.forEach((leaf, i) => {
      if (leaf.contents === "empty" && leaf.region) this.painter.polygon(leaf.region.vertices, color(i, info));
    });
  }

  /** Leaf adjacency: leaf centre → portal midpoint → leaf centre, once per opening, coloured by portal kind. */
  private drawPortalGraph(result: CompileResult): void {
    const { portalKind } = debugInfo(result);
    const center = (leaf: number) => centroid(result.tree.leaves[leaf].region!.vertices);
    result.tree.leaves.forEach((leaf, i) => { if (leaf.contents === "empty" && leaf.region) this.painter.dot(center(i), 2.5, COLORS.label); });
    for (const p of result.graph.portals) {
      if (p.id > p.twin) continue;
      const m = midpoint(p.winding.a, p.winding.b);
      const style = { color: rgbCss(PORTAL_KIND_RGB[portalKind[p.id]], 0.9), width: 1.5 };
      this.painter.line(center(p.from), m, style);
      this.painter.line(m, center(p.to), style);
    }
  }

  /** Highlights the probed leaf, its PVS, and dims everything it cannot see. */
  private drawPvs(result: CompileResult, view: ViewState): void {
    const p = view.inspect.point;
    if (!p) return;
    const current = locateLeaf(result.tree, p);
    if (result.tree.leaves[current].contents !== "empty") return;
    const row = result.pvs[current];
    const live = this.runtimeVisible(result, view, current, p);
    result.tree.leaves.forEach((leaf, i) => {
      if (leaf.contents !== "empty" || !leaf.region) return;
      const fill = i === current ? COLORS.pvsCurrent : !row.has(i) ? COLORS.pvsHidden : live && !live.has(i) ? COLORS.pvsRuntimeCulled : COLORS.pvsVisible;
      this.painter.polygon(leaf.region.vertices, fill);
    });
  }

  /**
   * Leaves the runtime portal-clipping query keeps from probe point `p` in leaf `leaf`
   * (omnidirectional; rect mode = cube map of screen rects), PVS-prefiltered. Null with the layer off.
   * Cached per (result, point, mode): it runs every frame otherwise.
   */
  private runtimeVisible(result: CompileResult, view: ViewState, leaf: number, p: Vec2): BitSet | null {
    if (!view.layers.runtime) return null;
    const clip = view.layers.runtimeRect ? "rect" : "planes";
    const c = this.runtimeCache;
    const shut = view.layers.closeDoors;
    if (c && c.result === result && c.x === p.x && c.y === p.y && c.clip === clip && c.shut === shut) return c.value;
    const portalOpen = shut ? doorPortalOpen(result.graph.portals.length, result.doors, result.doors.map((d) => d.name)) : undefined;
    const value = visibleLeaves(result.graph, leaf, p, { clip, pvsRow: result.pvs[leaf], portalOpen });
    this.runtimeCache = { result, x: p.x, y: p.y, clip, shut, value };
    return value;
  }

  /** Exact visibility polygon from the probe point — the PVS must always cover it. */
  private drawLineOfSight(result: CompileResult, view: ViewState): void {
    const p = view.inspect.point;
    if (!p || result.tree.leaves[locateLeaf(result.tree, p)].contents !== "empty") return;
    const b = result.tree.bounds;
    const maxDist = Math.sqrt((b.max.x - b.min.x) ** 2 + (b.max.y - b.min.y) ** 2);
    const poly = visibilityPolygon(result.walls.map((w) => w.winding), p, maxDist);
    this.painter.polygon(poly, COLORS.lineOfSight, { color: COLORS.lineOfSightStroke, width: 1 });
  }

  private drawBrushes(level: Level, selectedId: number | null): void {
    for (const b of level.brushes) {
      const c = kindColors(b.kind);
      const selected = b.id === selectedId;
      this.painter.polygon(b.vertices, b.kind === "solid" ? c.fill : null, {
        color: c.stroke,
        width: selected ? 2.5 : 1,
        dash: (b.kind === "room" || b.detail) && !selected ? (b.detail ? [1, 3] : [4, 3]) : [], // detail solids: dotted
      });
    }
  }

  private drawSplitters(result: CompileResult, labels: boolean): void {
    if (this.splitterCache?.result !== result) this.splitterCache = { result, segments: splitterSegments(result.tree) };
    this.splitterCache.segments.forEach((s, i) => {
      if (!s) return;
      this.painter.line(s.a, s.b, { color: COLORS.splitter, width: 1, dash: [6, 4] });
      if (labels) this.painter.text(midpoint(s.a, s.b), `n${i}`, COLORS.splitter, 10);
    });
  }

  /**
   * BSP tree focus: a leaf's region; for a node, the empty leaves of its front (cyan) / back
   * (orange) subtrees, its region outline and its splitter (the line clipped to the region,
   * with a tick along the normal, i.e. towards the front).
   */
  private drawBspFocus(result: CompileResult, ref: number): void {
    const { tree } = result;
    const focus = rgbCss(BSP_FOCUS_RGB, 1);
    if (isLeafRef(ref)) {
      const region = tree.leaves[refToLeaf(ref)]?.region;
      if (region) this.painter.polygon(region.vertices, rgbCss(BSP_FOCUS_RGB, 0.3), { color: focus, width: 2 });
      return;
    }
    const node = tree.nodes[ref];
    if (!node) return;
    const fill = (child: number, rgb: readonly [number, number, number]) => {
      for (const l of leavesUnder(tree, child)) {
        const leaf = tree.leaves[l];
        if (leaf.contents === "empty" && leaf.region) this.painter.polygon(leaf.region.vertices, rgbCss(rgb, 0.35), { color: rgbCss(rgb, 0.8), width: 1 });
      }
    };
    fill(node.front, BSP_FRONT_RGB);
    fill(node.back, BSP_BACK_RGB);
    if (node.region) this.painter.polygon(node.region.vertices, null, { color: rgbCss(BSP_FOCUS_RGB, 0.6), width: 1, dash: [4, 3] });
    if (this.splitterCache?.result !== result) this.splitterCache = { result, segments: splitterSegments(tree) };
    const s = this.splitterCache.segments[ref];
    if (s) {
      this.painter.line(s.a, s.b, { color: focus, width: 2.5 });
      const m = midpoint(s.a, s.b);
      this.painter.line(m, addScaled(m, tree.planes[node.plane].n, this.camera.pixels(12)), { color: focus, width: 2 });
    }
  }

  private drawWalls(result: CompileResult): void {
    const tick = this.camera.pixels(5);
    for (const w of result.walls) {
      this.painter.line(w.winding.a, w.winding.b, { color: COLORS.wall, width: 2 });
      const m = midpoint(w.winding.a, w.winding.b);
      this.painter.line(m, addScaled(m, w.plane.n, tick), { color: COLORS.wallTick, width: 1 });
    }
    // Detail faces: CSG-trimmed but not in the BSP; dashed to tell them apart.
    for (const w of result.detailWalls) this.painter.line(w.winding.a, w.winding.b, { color: COLORS.wall, width: 2, dash: [3, 3] });
  }

  /**
   * Leaf surfaces (wall pieces per empty leaf, what a game would draw), coloured by the
   * probed leaf's PVS row: current / visible / culled (hidden entirely with `hideCulled`).
   * Without a probe (or with the PVS layer off) they are drawn neutral.
   */
  private drawSurfaces(result: CompileResult, view: ViewState): void {
    const p = view.inspect.point;
    let current = -1;
    if (p && view.layers.pvs) {
      const leaf = locateLeaf(result.tree, p);
      if (result.tree.leaves[leaf].contents === "empty") current = leaf;
    }
    // With runtime clipping on, surfaces are coloured by what the runtime query keeps (⊆ PVS).
    const row = current >= 0 ? (this.runtimeVisible(result, view, current, p!) ?? result.pvs[current]) : null;
    result.surfaces.forEach((surfs, leaf) => {
      let color: string = COLORS.surface;
      if (row && leaf === current) color = COLORS.surfaceCurrent;
      else if (row && row.has(leaf)) color = COLORS.surfaceVisible;
      else if (row) {
        if (view.layers.hideCulled) return;
        color = COLORS.surfaceHidden;
      }
      for (const s of surfs) this.painter.line(s.winding.a, s.winding.b, { color, width: 3 });
    });
  }

  private drawPortals(result: CompileResult, view: ViewState): void {
    const { graph, mightSee, portalVis } = result;
    const hovered = view.inspect.portal;
    const drawn = new Set<number>();
    for (const p of graph.portals) {
      if (drawn.has(p.twin)) continue; // draw each opening once
      drawn.add(p.id);
      this.painter.line(p.winding.a, p.winding.b, { color: hovered === null ? COLORS.portal : COLORS.portalDim, width: 2 });
    }
    if (hovered === null || !graph.portals[hovered]) return;

    // Hovered portal: base-vis ("might see") in purple, final flow result in cyan.
    for (const id of mightSee[hovered].toArray()) {
      const q = graph.portals[id];
      if (!portalVis[hovered].has(id)) this.painter.line(q.winding.a, q.winding.b, { color: COLORS.portalMightSee, width: 3, dash: [4, 3] });
    }
    for (const id of portalVis[hovered].toArray()) {
      const q = graph.portals[id];
      this.painter.line(q.winding.a, q.winding.b, { color: COLORS.portalVis, width: 3 });
    }
    const p = graph.portals[hovered];
    const m = midpoint(p.winding.a, p.winding.b);
    this.painter.line(p.winding.a, p.winding.b, { color: COLORS.portalSelected, width: 4 });
    this.painter.arrow(m, addScaled(m, p.plane.n, this.camera.pixels(18)), { color: COLORS.portalSelected, width: 2 });
  }

  private drawLabels(result: CompileResult): void {
    result.tree.leaves.forEach((leaf, i) => {
      if (leaf.contents !== "empty" || !leaf.region) return;
      this.painter.text(centroid(leaf.region.vertices), `L${i}`, COLORS.label, 11);
    });
    const drawn = new Set<number>();
    for (const p of result.graph.portals) {
      if (drawn.has(p.twin)) continue;
      drawn.add(p.id);
      const at: Vec2 = addScaled(midpoint(p.winding.a, p.winding.b), p.plane.n, this.camera.pixels(9));
      this.painter.text(at, `${p.id}/${p.twin}`, COLORS.portal, 9);
    }
  }

  private drawLeaks(result: CompileResult): void {
    for (const i of result.leaks.boundaryLeaves) {
      const region = result.tree.leaves[i].region;
      if (region) this.painter.polygon(region.vertices, "rgba(255, 59, 59, 0.15)", { color: COLORS.leak, width: 2, dash: [8, 4] });
    }
  }
}
