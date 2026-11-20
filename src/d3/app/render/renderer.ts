/**
 * Draws the editor scene with WebGL2 plus a 2D overlay canvas.
 *
 * Passes, in order:
 *   1. opaque leaf surfaces (back faces culled, so the camera can look into
 *      rooms from outside; coloured by leaf or by the probed PVS),
 *   2. depth-tested lines: work-plane grid, wall edges, BSP cells, splitters,
 *   3. translucent fills: portals, solid brushes,
 *   4. x-ray lines (no depth test): brush outlines, portal outlines, portal-vis
 *      sets, leaks, line-of-sight rays,
 *   5. 2D overlay: labels, probe, ray hits, tool handles.
 *
 * GPU buffers are rebuilt only when their inputs change (see {@link Cached}).
 */

import {
  type CompileResult, type Level, type Vec3,
  type BitSet, type View, addScaled, castRay, locateLeaf, visibleLeaves, doorPortalOpen, normalize, polyhedronCenter, sphereDirections, splitterWindings, windingCenter, aabbDiagonal,
  isLeafRef, leavesUnder, refToLeaf,
} from "../../core";
import type { Camera } from "../editor/camera";
import type { ViewState } from "../editor/viewState";
import type { Tool } from "../editor/tools/tool";
import { GlContext, type GpuMesh, LineBuilder, TriangleBuilder } from "./gl";
import { Overlay } from "./overlay";
import { PORTAL_KIND_RGB, debugInfo, groupRgb, heatRgb } from "../../../shared/app/render/debugInfo";
import { BSP_BACK_RGB, BSP_FOCUS_RGB, BSP_FRONT_RGB } from "../../../shared/app/render/palette";
import { BACKGROUND, CSS_COLORS, GL_COLORS, type Rgba, kindRgba, leafRgb } from "./colors";

export interface Probe {
  readonly point: Vec3;
  /** Empty leaf containing the probe point. */
  readonly leaf: number;
  /** Camera view when probing from the camera (runtime clipping then uses the real frustum); else omnidirectional. */
  readonly view?: View;
}

export interface SceneInput {
  readonly level: Level;
  readonly selectedId: number | null;
  readonly compiled: CompileResult | null;
  readonly view: ViewState;
  readonly tool: Tool;
  readonly probe: Probe | null;
}

/** Re-uploads a mesh only when one of its keys changed (compared with ===). */
class Cached {
  private keys: readonly unknown[] | null = null;
  constructor(readonly mesh: GpuMesh) {}

  update(keys: readonly unknown[], build: () => Float32Array): void {
    if (this.keys && this.keys.length === keys.length && this.keys.every((k, i) => k === keys[i])) return;
    this.keys = keys;
    this.mesh.upload(build());
  }
}

interface RayResult {
  readonly from: Vec3;
  readonly hits: readonly { readonly point: Vec3; readonly visible: boolean }[];
}

const LIGHT = normalize({ x: 0.35, y: 0.25, z: 0.9 });
const RAY_COUNT = 384;

export class Renderer {
  private readonly glc: GlContext;
  private readonly overlay: Overlay;
  private readonly octx: CanvasRenderingContext2D;
  private readonly surfaces: Cached;
  private readonly lines: Cached;
  private readonly grid: Cached;
  private readonly fills: Cached;
  private readonly xray: Cached;
  private rays: { result: CompileResult; point: Vec3; value: RayResult } | null = null;
  private splitters: { result: CompileResult; value: ReturnType<typeof splitterWindings> } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlayCanvas: HTMLCanvasElement, private readonly camera: Camera) {
    const gl = canvas.getContext("webgl2", { antialias: true });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    const octx = overlayCanvas.getContext("2d");
    if (!octx) throw new Error("Canvas 2D context unavailable");
    this.glc = new GlContext(gl);
    this.octx = octx;
    this.overlay = new Overlay(octx, camera);
    this.surfaces = new Cached(this.glc.triangleMesh());
    this.fills = new Cached(this.glc.triangleMesh());
    this.lines = new Cached(this.glc.lineMesh());
    this.grid = new Cached(this.glc.lineMesh());
    this.xray = new Cached(this.glc.lineMesh());
  }

  /** Matches the backing stores to the element size and device pixel ratio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    for (const c of [this.canvas, this.overlayCanvas]) {
      c.width = Math.max(1, Math.round(w * dpr));
      c.height = Math.max(1, Math.round(h * dpr));
    }
    this.camera.resize(w, h);
  }

  draw(scene: SceneInput): void {
    const { gl } = this.glc;
    const { layers } = scene.view;
    const result = scene.compiled;
    const hovered = scene.view.inspect.portal !== null && result?.graph.portals[scene.view.inspect.portal] ? scene.view.inspect.portal : null;
    const probe = scene.probe;
    const rays = result && probe && layers.lineOfSight ? this.lineOfSight(result, probe) : null;

    this.surfaces.update([result, layers.surfaces, layers.pvs, layers.hideCulled, layers.clusters, layers.pvsHeat, probe?.leaf, layers.runtime, layers.runtimeRect, layers.closeDoors, layers.bspDepth, layers.bspTree && scene.view.bspFocus, ...runtimeKey(probe, layers.runtime)], () => this.buildSurfaces(result, scene.view, probe));
    this.lines.update([result, layers.walls, layers.leaves, layers.splitters], () => this.buildLines(result, scene.view));
    this.grid.update([layers.grid, scene.view.workZ, scene.view.gridSize, ...this.gridAnchor(scene.view.gridSize)], () => this.buildGrid(scene.view));
    this.fills.update([result, scene.level, layers.portals, layers.brushes, hovered], () => this.buildFills(result, scene, hovered));
    this.xray.update([result, scene.level, scene.selectedId, layers.brushes, layers.portals, layers.portalGraph, hovered, rays, layers.bspTree && scene.view.bspFocus], () => this.buildXray(result, scene, hovered, rays));

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...BACKGROUND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const vp = this.camera.viewProjection();

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    this.glc.useTriangles(vp, LIGHT);
    this.surfaces.mesh.draw(gl.TRIANGLES);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.CULL_FACE);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.glc.useLines(vp);
    this.grid.mesh.draw(gl.LINES);
    this.lines.mesh.draw(gl.LINES);

    gl.depthMask(false);
    this.glc.useTriangles(vp, LIGHT);
    this.fills.mesh.draw(gl.TRIANGLES);

    gl.disable(gl.DEPTH_TEST);
    this.glc.useLines(vp);
    this.xray.mesh.draw(gl.LINES);
    gl.depthMask(true);

    this.drawOverlay(scene, result, hovered, rays);
  }

  // ---- Geometry builders --------------------------------------------------

  private buildSurfaces(result: CompileResult | null, view: ViewState, probe: Probe | null): Float32Array {
    const tb = new TriangleBuilder();
    if (!result || !view.layers.surfaces) return tb.build();
    const row = probe && view.layers.pvs ? result.pvs[probe.leaf] : null;
    const live = row && view.layers.runtime ? runtimeVisible(result, probe!, view.layers.runtimeRect, view.layers.closeDoors) : null;
    const n = GL_COLORS.surfaceNeutral;
    const side = view.layers.bspTree ? bspFocusSides(result, view.bspFocus) : null;
    const maxDepth = result.tree.leaves.reduce((m, l) => Math.max(m, l.depth), 1);
    result.surfaces.forEach((surfs, leaf) => {
      if (surfs.length === 0) return;
      let color: Rgba;
      if (side) {
        // BSP tree focus: front subtree cyan, back subtree orange, the rest neutral.
        const sd = side[leaf];
        const c = sd === 1 ? BSP_FRONT_RGB : sd === 2 ? BSP_BACK_RGB : sd === 3 ? BSP_FOCUS_RGB : null;
        color = c ? [n[0] * 0.3 + c[0] * 0.7, n[1] * 0.3 + c[1] * 0.7, n[2] * 0.3 + c[2] * 0.7, 1] : n;
      } else if (row && leaf === probe!.leaf) color = GL_COLORS.pvsCurrent;
      else if (row && !row.has(leaf)) {
        if (view.layers.hideCulled) return;
        color = GL_COLORS.pvsHidden;
      } else if (live && !live.has(leaf)) {
        if (view.layers.hideCulled) return;
        color = GL_COLORS.pvsRuntimeCulled;
      } else if (view.layers.bspDepth) {
        color = [...heatRgb(result.tree.leaves[leaf].depth / maxDepth), 1];
      } else if (view.layers.pvsHeat) {
        color = [...heatRgb(debugInfo(result).pvsHeat[leaf]), 1];
      } else {
        // Leaf tint, or cluster tint with the clusters layer (all leaves of a cluster alike).
        const c = view.layers.clusters ? groupRgb(debugInfo(result).leafGroup[leaf]) : leafRgb(leaf);
        const k = view.layers.clusters ? 0.75 : 0.4;
        color = [n[0] * (1 - k) + c[0] * k, n[1] * (1 - k) + c[1] * k, n[2] * (1 - k) + c[2] * k, 1];
      }
      for (const s of surfs) tb.polygon(s.winding, result.walls[s.wall].plane.n, color);
    });
    // Detail faces belong to no leaf (they are not in the BSP), so they stay neutral.
    for (const w of result.detailWalls) tb.polygon(w.winding, w.plane.n, n);
    return tb.build();
  }

  private buildLines(result: CompileResult | null, view: ViewState): Float32Array {
    const lb = new LineBuilder();
    if (!result) return lb.build();
    const { layers } = view;
    if (layers.walls) for (const w of [...result.walls, ...result.detailWalls]) lb.loop(w.winding, GL_COLORS.wall);
    if (layers.leaves) {
      for (const leaf of result.tree.leaves) {
        if (leaf.contents !== "empty" || !leaf.region) continue;
        for (const f of leaf.region.faces) lb.loop(f.winding, GL_COLORS.leafEdge);
      }
    }
    if (layers.splitters) {
      if (this.splitters?.result !== result) this.splitters = { result, value: splitterWindings(result.tree) };
      for (const w of this.splitters.value) if (w) lb.loop(w, GL_COLORS.splitter);
    }
    return lb.build();
  }

  /** Grid anchor (snapped camera target and zoom level) so the grid follows the camera. */
  private gridAnchor(gridSize: number): number[] {
    const step = this.gridStep(gridSize);
    const major = step * 8;
    return [Math.round(this.camera.target.x / major), Math.round(this.camera.target.y / major), step];
  }

  private gridStep(gridSize: number): number {
    let step = gridSize > 0 ? gridSize : 1;
    const extent = this.gridExtent();
    while ((extent * 2) / step > 160) step *= 2;
    return step;
  }

  private gridExtent(): number {
    return Math.min(2000, Math.max(16, this.camera.distance * 2.5));
  }

  private buildGrid(view: ViewState): Float32Array {
    const lb = new LineBuilder();
    if (!view.layers.grid) return lb.build();
    const step = this.gridStep(view.gridSize);
    const major = step * 8;
    const extent = Math.ceil(this.gridExtent() / major) * major;
    const cx = Math.round(this.camera.target.x / major) * major;
    const cy = Math.round(this.camera.target.y / major) * major;
    const z = view.workZ;
    for (let k = -extent; k <= extent + 1e-9; k += step) {
      const isMajor = Math.abs(Math.round(k / major) * major - k) < 1e-9;
      const c = isMajor ? GL_COLORS.gridMajor : GL_COLORS.gridMinor;
      const x = cx + k, y = cy + k;
      lb.segment({ x, y: cy - extent, z }, { x, y: cy + extent, z }, Math.abs(x) < 1e-9 ? GL_COLORS.axisY : c);
      lb.segment({ x: cx - extent, y, z }, { x: cx + extent, y, z }, Math.abs(y) < 1e-9 ? GL_COLORS.axisX : c);
    }
    return lb.build();
  }

  private buildFills(result: CompileResult | null, scene: SceneInput, hovered: number | null): Float32Array {
    const tb = new TriangleBuilder();
    const { layers } = scene.view;
    if (layers.brushes) {
      for (const b of scene.level.brushes) {
        if (b.kind !== "solid") continue;
        for (const f of b.faces) tb.polygon(f.winding, f.plane.n, kindRgba("solid", 0.1));
      }
    }
    if (result && layers.portals) {
      const drawn = new Set<number>();
      for (const p of result.graph.portals) {
        if (drawn.has(p.twin)) continue;
        drawn.add(p.id);
        tb.polygon(p.winding, p.plane.n, GL_COLORS.portalFill); // fills are drawn unculled: one side suffices
      }
      if (hovered !== null) {
        for (const id of result.portalVis[hovered].toArray()) tb.polygon(result.graph.portals[id].winding, result.graph.portals[id].plane.n, GL_COLORS.portalVisFill);
      }
    }
    return tb.build();
  }

  private buildXray(result: CompileResult | null, scene: SceneInput, hovered: number | null, rays: RayResult | null): Float32Array {
    const lb = new LineBuilder();
    const { layers } = scene.view;
    if (layers.brushes) {
      for (const b of scene.level.brushes) {
        if (b.id === scene.selectedId) continue; // drawn thick in the overlay
        const c = kindRgba(b.kind, b.kind === "room" ? 0.45 : 0.7);
        for (const f of b.faces) lb.loop(f.winding, c);
      }
      for (const m of scene.level.meshes) for (const f of m.faces) lb.loop(f, [0.8, 0.8, 0.8, 0.35]);
    }
    if (result && layers.portals) {
      const drawn = new Set<number>();
      for (const p of result.graph.portals) {
        if (drawn.has(p.twin)) continue;
        drawn.add(p.id);
        lb.loop(p.winding, hovered === null ? GL_COLORS.portal : GL_COLORS.portalDim);
      }
      if (hovered !== null) {
        // Base vis ("might see") but rejected by the flow in purple; final flow result in cyan.
        for (const id of result.mightSee[hovered].toArray()) {
          if (!result.portalVis[hovered].has(id)) lb.loop(result.graph.portals[id].winding, GL_COLORS.portalMightSee);
        }
        for (const id of result.portalVis[hovered].toArray()) lb.loop(result.graph.portals[id].winding, GL_COLORS.portalVis);
      }
    }
    if (result && layers.portalGraph) {
      // Leaf adjacency: leaf centre → portal centre → leaf centre, once per opening, coloured by portal kind.
      const { portalKind } = debugInfo(result);
      const center = (leaf: number) => polyhedronCenter(result.tree.leaves[leaf].region!);
      for (const p of result.graph.portals) {
        if (p.id > p.twin) continue;
        const m = windingCenter(p.winding);
        const c: Rgba = [...PORTAL_KIND_RGB[portalKind[p.id]], 0.85];
        lb.segment(center(p.from), m, c);
        lb.segment(m, center(p.to), c);
      }
    }
    if (result?.leaks.leaking) {
      for (const i of result.leaks.boundaryLeaves) {
        const region = result.tree.leaves[i].region;
        if (region) for (const f of region.faces) lb.loop(f.winding, GL_COLORS.leak);
      }
    }
    if (rays) for (const h of rays.hits) lb.segment(rays.from, h.point, GL_COLORS.ray);
    if (result && layers.bspTree && scene.view.bspFocus !== null) this.bspFocusLines(lb, result, scene.view.bspFocus);
    return lb.build();
  }

  /**
   * BSP tree focus (x-ray): a leaf's region; for a node, its region, its splitter (the plane
   * clipped to the region) and the empty leaves of its front / back subtrees.
   */
  private bspFocusLines(lb: LineBuilder, result: CompileResult, ref: number): void {
    const { tree } = result;
    const outline = (leaf: number, c: Rgba) => {
      const l = tree.leaves[leaf];
      if (l?.region && l.contents === "empty") for (const f of l.region.faces) lb.loop(f.winding, c);
    };
    if (isLeafRef(ref)) {
      const region = tree.leaves[refToLeaf(ref)]?.region;
      if (region) for (const f of region.faces) lb.loop(f.winding, [...BSP_FOCUS_RGB, 1]);
      return;
    }
    const node = tree.nodes[ref];
    if (!node) return;
    for (const l of leavesUnder(tree, node.front)) outline(l, [...BSP_FRONT_RGB, 0.5]);
    for (const l of leavesUnder(tree, node.back)) outline(l, [...BSP_BACK_RGB, 0.5]);
    if (node.region) for (const f of node.region.faces) lb.loop(f.winding, [...BSP_FOCUS_RGB, 0.6]);
    if (this.splitters?.result !== result) this.splitters = { result, value: splitterWindings(tree) };
    const w = this.splitters.value[ref];
    if (w) {
      lb.loop(w, [...BSP_FOCUS_RGB, 1]);
      // Diagonals make the splitter read as a surface, not just another outline.
      for (let i = 1; i + 1 < w.length; i++) lb.segment(w[0], w[i + 1], [...BSP_FOCUS_RGB, 0.35]);
    }
  }

  // ---- Line of sight -------------------------------------------------------

  /**
   * Ground truth: rays from the probe to the first wall they hit. Every leaf a
   * ray passes through is truly visible, so the leaf just in front of each hit
   * must be in the PVS row (green); a red hit would be a PVS bug.
   */
  private lineOfSight(result: CompileResult, probe: Probe): RayResult {
    if (this.rays && this.rays.result === result && this.rays.point === probe.point) return this.rays.value;
    const maxDist = aabbDiagonal(result.tree.bounds);
    const row = result.pvs[probe.leaf];
    const hits: { point: Vec3; visible: boolean }[] = [];
    for (const dir of sphereDirections(RAY_COUNT)) {
      const hit = castRay(result.walls, probe.point, dir, maxDist);
      if (!hit) continue;
      const leaf = locateLeaf(result.tree, addScaled(hit.point, dir, -0.02));
      hits.push({ point: hit.point, visible: row.has(leaf) || result.tree.leaves[leaf].contents !== "empty" });
    }
    const value: RayResult = { from: probe.point, hits };
    this.rays = { result, point: probe.point, value };
    return value;
  }

  // ---- Overlay ---------------------------------------------------------------

  private drawOverlay(scene: SceneInput, result: CompileResult | null, hovered: number | null, rays: RayResult | null): void {
    const ctx = this.octx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.camera.width, this.camera.height);
    const o = this.overlay;
    const { layers } = scene.view;

    const sel = scene.level.brushes.find((b) => b.id === scene.selectedId);
    if (sel) for (const f of sel.faces) o.loop(f.winding, { color: kindCssBright(sel.kind), width: 2 });

    if (result && layers.labels) {
      result.tree.leaves.forEach((leaf, i) => {
        if (leaf.contents === "empty" && leaf.region) o.text(polyhedronCenter(leaf.region), `L${i}`, CSS_COLORS.label, 11);
      });
      const drawn = new Set<number>();
      for (const p of result.graph.portals) {
        if (drawn.has(p.twin)) continue;
        drawn.add(p.id);
        o.text(windingCenter(p.winding), `${p.id}/${p.twin}`, CSS_COLORS.portalLabel, 9);
      }
    }

    if (result && hovered !== null) {
      const p = result.graph.portals[hovered];
      o.loop(p.winding, { color: "#ffffff", width: 3 });
      const c = windingCenter(p.winding);
      o.arrow(c, addScaled(c, p.plane.n, this.camera.pixelsToWorld(28, c)), { color: "#ffffff", width: 2 });
    }

    if (rays) for (const h of rays.hits) o.dot(h.point, h.visible ? 1.6 : 3.5, h.visible ? CSS_COLORS.rayOk : CSS_COLORS.rayBad);
    if (scene.probe) o.dot(scene.probe.point, scene.view.inspect.pinned ? 5 : 4, CSS_COLORS.probe, { color: "#000", width: 1 });
    else if (scene.tool.id === "inspect" && scene.view.inspect.point) o.dot(scene.view.inspect.point, 4, "#888", { color: "#000", width: 1 });

    scene.tool.drawOverlay?.(o);
  }
}

/**
 * Per leaf, which side of the focused BSP ref it is on: 1 front subtree, 2 back subtree,
 * 3 the focused leaf itself, 0 elsewhere. Null when nothing is focused.
 */
function bspFocusSides(result: CompileResult, ref: number | null): Uint8Array | null {
  if (ref === null) return null;
  const { tree } = result;
  const side = new Uint8Array(tree.leaves.length);
  if (isLeafRef(ref)) {
    if (refToLeaf(ref) < side.length) side[refToLeaf(ref)] = 3;
    return side;
  }
  const node = tree.nodes[ref];
  if (!node) return null;
  for (const l of leavesUnder(tree, node.front)) side[l] = 1;
  for (const l of leavesUnder(tree, node.back)) side[l] = 2;
  return side;
}

function kindCssBright(kind: "room" | "solid"): string {
  return kind === "room" ? "#8cc6ff" : "#ff8c9b";
}

/**
 * Leaves the runtime portal-clipping query keeps from `probe` (phase 4), PVS-prefiltered: through the
 * camera frustum when probing from the camera, else omnidirectional (rect mode: cube map of rects).
 * `closeDoors`: every door (phase 4b) is shut.
 */
function runtimeVisible(result: CompileResult, probe: Probe, rect: boolean, closeDoors: boolean): BitSet {
  const portalOpen = closeDoors ? doorPortalOpen(result.graph.portals.length, result.doors, result.doors.map((d) => d.name)) : undefined;
  return visibleLeaves(result.graph, probe.leaf, probe.point, { clip: rect ? "rect" : "planes", view: probe.view, pvsRow: result.pvs[probe.leaf], portalOpen });
}

/** Cache key of {@link runtimeVisible}'s inputs (point and view direction; empty when the layer is off). */
function runtimeKey(probe: Probe | null, on: boolean): number[] {
  if (!probe || !on) return [];
  const { point: p, view: v } = probe;
  return [p.x, p.y, p.z, ...(v ? [v.forward.x, v.forward.y, v.forward.z, ...v.rect!.max] : [])];
}
