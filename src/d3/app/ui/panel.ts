/**
 * Side panel: tools, work plane, level actions, layer toggles, compiler
 * options, stats and probe read-outs. Static controls are built once;
 * {@link Panel.update} refreshes the parts that depend on state.
 */

import {
  type BrushKind, type CompileOptions, type CompileResult, type PvsSymmetry,
  DEFAULT_BSP_OPTIONS, SAMPLE_LEVELS, brushVolume, locateLeaf,
} from "../../core";
import type { EditorModel } from "../editor/model";
import { type Layers, LAYER_LABELS, type ViewState } from "../editor/viewState";
import type { Tool, ToolId } from "../editor/tools/tool";
import { h } from "./dom";

/** What the panel needs from the application. */
export interface PanelHost {
  readonly model: EditorModel;
  readonly view: ViewState;
  readonly tools: readonly Tool[];
  readonly activeTool: Tool;
  readonly options: CompileOptions;
  readonly compiling: boolean;
  compiled(): CompileResult | null;
  compileError(): string | null;
  setTool(id: ToolId): void;
  setOptions(options: Partial<CompileOptions>): void;
  requestRender(): void;
  newLevel(): void;
  loadSample(index: number): void;
  openLevel(): void;
  saveLevel(): void;
  importObj(options: { flipNormals: boolean; yUp: boolean; scale: number }): void;
  exportPvsJson(): void;
  exportPvsText(): void;
  fitView(): void;
}

export class Panel {
  private readonly toolButtons = new Map<ToolId, HTMLButtonElement>();
  private readonly kindButtons = new Map<BrushKind, HTMLButtonElement>();
  private readonly selectionBox = h("div", { class: "readout" });
  private readonly statsBox = h("div", { class: "readout" });
  private readonly probeBox = h("div", { class: "readout" });
  private readonly meshBox = h("div", { class: "readout" });
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly workZInput: HTMLInputElement;
  private readonly fromCameraBox: HTMLInputElement;

  constructor(root: HTMLElement, private readonly host: PanelHost) {
    const { model, view } = host;

    const tools = h("div", { class: "button-row" });
    for (const tool of host.tools) {
      const b = h("button", { title: `${tool.hint} [${tool.shortcut.toUpperCase()}]`, onclick: () => host.setTool(tool.id) }, `${tool.label} `, h("kbd", {}, tool.shortcut.toUpperCase()));
      this.toolButtons.set(tool.id, b);
      tools.append(b);
    }

    const kinds = h("div", { class: "button-row" });
    for (const kind of ["room", "solid"] as const) {
      const b = h("button", { class: `kind-${kind}`, onclick: () => { model.newBrushKind = kind; this.update(); } }, kind === "room" ? "Room (empty)" : "Solid (occluder)");
      this.kindButtons.set(kind, b);
      kinds.append(b);
    }

    this.workZInput = numberInput(view.workZ, (v) => { view.workZ = v; host.requestRender(); }, -1e4, 0.5);
    const workPlane = h("div", { class: "stack" },
      h("label", { class: "field", title: "[ / ] or PageDown / PageUp move it by one grid step" }, h("span", {}, "Work plane height (z)"), this.workZInput),
      h("label", { class: "field", title: "Negative values extrude downwards" }, h("span", {}, "New brush height"), numberInput(view.brushHeight, (v) => { view.brushHeight = v; }, -1e4, 0.5)),
    );

    this.undoButton = h("button", { onclick: () => model.undo(), title: "Ctrl+Z" }, "Undo");
    this.redoButton = h("button", { onclick: () => model.redo(), title: "Ctrl+Y / Ctrl+Shift+Z" }, "Redo");

    const sampleSelect = h("select", {}, ...SAMPLE_LEVELS.map((s, i) => h("option", { value: i, title: s.description }, s.name)));
    const level = h("div", { class: "stack" },
      h("div", { class: "button-row" },
        sampleSelect,
        h("button", { onclick: () => host.loadSample(Number(sampleSelect.value)) }, "Load sample"),
      ),
      h("div", { class: "button-row" },
        h("button", { onclick: () => host.newLevel() }, "New"),
        h("button", { onclick: () => host.openLevel() }, "Open…"),
        h("button", { onclick: () => host.saveLevel() }, "Save…"),
        this.undoButton,
        this.redoButton,
      ),
      h("div", { class: "button-row" },
        h("button", { class: "primary", onclick: () => host.exportPvsJson() }, "Export PVS (.json)"),
        h("button", { class: "primary", onclick: () => host.exportPvsText() }, "Export PVS (.txt)"),
      ),
    );

    const obj = { flipNormals: false, yUp: true, scale: 1 };
    const importBox = h("div", { class: "stack" },
      h("div", { class: "hint" }, "Raw faces, no CSG; normals must point into the rooms. Leaks are reported, not fatal."),
      h("div", { class: "button-row" },
        checkbox("Y-up (Blender OBJ default)", obj.yUp, (v) => { obj.yUp = v; }),
        checkbox("Flip normals", obj.flipNormals, (v) => { obj.flipNormals = v; }),
      ),
      h("label", { class: "field" }, h("span", {}, "Scale"), numberInput(obj.scale, (v) => { if (v > 0) obj.scale = v; }, 0, 0.1)),
      h("div", { class: "button-row" }, h("button", { onclick: () => host.importObj({ ...obj }) }, "Import OBJ…")),
      this.meshBox,
    );

    const gridSelect = h("select", { onchange: (e: Event) => { view.gridSize = Number((e.target as HTMLSelectElement).value); host.requestRender(); } },
      ...[0.125, 0.25, 0.5, 1, 2, 4].map((g) => h("option", { value: g, selected: g === view.gridSize }, `${g}`)));
    const snap = h("div", { class: "button-row" },
      checkbox("Snap to grid", view.snap, (v) => { view.snap = v; }),
      h("label", {}, "Grid ", gridSelect),
      h("button", { onclick: () => host.fitView(), title: "F" }, "Fit view"),
    );

    const layers = h("div", { class: "layers" });
    for (const key of Object.keys(view.layers) as (keyof Layers)[]) {
      layers.append(checkbox(LAYER_LABELS[key], view.layers[key], (v) => { view.layers[key] = v; host.requestRender(); }));
    }

    const opts = host.options;
    const symmetry = h("select", { onchange: (e: Event) => host.setOptions({ symmetry: (e.target as HTMLSelectElement).value as PvsSymmetry }) },
      ...(["none", "intersect", "union"] as const).map((s) => h("option", { value: s, selected: opts.symmetry === s }, s)));
    const bsp = (patch: Partial<typeof DEFAULT_BSP_OPTIONS>) => host.setOptions({ bsp: { ...host.options.bsp, ...patch } });
    const compiler = h("div", { class: "stack" },
      numberField("BSP split weight", opts.bsp.splitWeight ?? DEFAULT_BSP_OPTIONS.splitWeight, (v) => bsp({ splitWeight: v })),
      numberField("BSP balance weight", opts.bsp.balanceWeight ?? DEFAULT_BSP_OPTIONS.balanceWeight, (v) => bsp({ balanceWeight: v })),
      checkbox("Corner splits (extend walls into touching cells)", opts.bsp.cornerSplits ?? DEFAULT_BSP_OPTIONS.cornerSplits, (v) => bsp({ cornerSplits: v })),
      numberField("Min cell size", opts.bsp.minCellSize ?? DEFAULT_BSP_OPTIONS.minCellSize, (v) => bsp({ minCellSize: v }),
        "Refinement splits never create cells thinner than this (0 = no limit)"),
      numberField("Max cell size (0 = off)", opts.bsp.maxCellSize ?? DEFAULT_BSP_OPTIONS.maxCellSize, (v) => bsp({ maxCellSize: v }),
        "Empty cells larger than this along any axis are halved"),
      checkbox("Clip source by reverse antipenumbra", opts.flow.clipSource ?? true, (v) => host.setOptions({ flow: { ...host.options.flow, clipSource: v } })),
      h("label", { class: "field" }, h("span", {}, "PVS symmetry"), symmetry),
    );

    this.fromCameraBox = h("input", {
      type: "checkbox", checked: view.inspect.fromCamera,
      onchange: (e: Event) => { view.inspect.fromCamera = (e.target as HTMLInputElement).checked; host.requestRender(); },
    });

    root.append(
      h("header", {}, h("h1", {}, "polyvis ", h("span", { class: "tag" }, "3D")), h("p", {}, "CSG → BSP → portals → portal flow → PVS")),
      section("Tools", tools, h("div", { class: "hint" }, "New brushes are:"), kinds, workPlane),
      section("Selection", this.selectionBox),
      section("Level", level),
      section("Import mesh (Blender)", importBox),
      section("Snapping", snap),
      section("Layers", layers),
      section("Compiler", compiler),
      section("Stats", this.statsBox),
      section("Probe", h("label", { class: "check", title: "Fly through the level (WASD) and watch the PVS of the camera's leaf" }, this.fromCameraBox, "Probe from camera position"), this.probeBox),
      section("Navigation", h("div", { class: "hint" },
        "Right drag orbit · middle drag / Shift+right drag pan · wheel zoom · WASD fly, Q/E down/up (Shift = fast) · F fit · [ ] work plane · K room/solid · Ctrl+Z/Y undo/redo")),
    );
    this.update();
  }

  /** Refreshes all state-dependent parts of the panel. */
  update(): void {
    const { model, view } = this.host;
    for (const [id, b] of this.toolButtons) b.classList.toggle("active", id === this.host.activeTool.id);
    for (const [kind, b] of this.kindButtons) b.classList.toggle("active", kind === model.newBrushKind);
    this.undoButton.disabled = !model.canUndo;
    this.redoButton.disabled = !model.canRedo;
    if (document.activeElement !== this.workZInput) this.workZInput.value = String(view.workZ);
    this.fromCameraBox.checked = view.inspect.fromCamera;
    // Rebuild read-outs only when their inputs change (update() runs every frame while flying).
    const r = this.host.compiled();
    if (this.changed("selection", [model.selectedBrush, view.gridSize])) this.renderSelection();
    if (this.changed("meshes", [model.level.meshes])) this.renderMeshes();
    if (this.changed("stats", [r, this.host.compileError(), this.host.compiling, model.level])) this.renderStats();
    if (this.changed("probe", [r, view.inspect.point, view.inspect.pinned, view.inspect.portal])) this.renderProbe(view);
  }

  private readonly lastKeys = new Map<string, readonly unknown[]>();

  private changed(section: string, keys: readonly unknown[]): boolean {
    const prev = this.lastKeys.get(section);
    if (prev && prev.length === keys.length && prev.every((k, i) => k === keys[i])) return false;
    this.lastKeys.set(section, keys);
    return true;
  }

  private renderSelection(): void {
    const { model, view } = this.host;
    const b = model.selectedBrush;
    if (!b) {
      this.selectionBox.replaceChildren(h("span", { class: "muted" }, "Nothing selected"));
      return;
    }
    const f = (v: number) => +v.toFixed(3);
    const { min, max } = b.bounds;
    const g = view.gridSize > 0 ? view.gridSize : 1;
    this.selectionBox.replaceChildren(
      kv("Brush", `#${b.id} (${b.kind})`),
      kv("Faces / volume", `${b.faces.length} / ${f(brushVolume(b))}`),
      kv("Min", `${f(min.x)}, ${f(min.y)}, ${f(min.z)}`),
      kv("Max", `${f(max.x)}, ${f(max.y)}, ${f(max.z)}`),
      h("div", { class: "button-row" },
        h("button", { onclick: () => model.setKind(b.id, b.kind === "room" ? "solid" : "room") }, "Toggle kind"),
        h("button", { onclick: () => model.duplicateBrush(b.id, { x: g, y: -g, z: 0 }) }, "Duplicate"),
        h("button", { onclick: () => { view.workZ = f(b.bounds.min.z); this.host.requestRender(); }, title: "Put the work plane at this brush's floor" }, "Work plane → floor"),
        h("button", { class: "danger", onclick: () => model.removeBrush(b.id) }, "Delete"),
      ),
    );
  }

  private renderMeshes(): void {
    const { model } = this.host;
    const meshes = model.level.meshes;
    if (meshes.length === 0) {
      this.meshBox.replaceChildren();
      return;
    }
    this.meshBox.replaceChildren(
      ...meshes.map((m) => kv(m.name, `${m.faces.length} faces`)),
      h("div", { class: "button-row" }, h("button", { class: "danger", onclick: () => model.removeMeshes() }, "Remove meshes")),
    );
  }

  private renderStats(): void {
    const error = this.host.compileError();
    const r = this.host.compiled();
    const busy = this.host.compiling ? [h("div", { class: "muted" }, "Compiling…")] : [];
    if (error) {
      this.statsBox.replaceChildren(h("div", { class: "error" }, `Compile error: ${error}`), ...busy);
      return;
    }
    if (!r) {
      this.statsBox.replaceChildren(h("span", { class: "muted" }, "Not compiled"), ...busy);
      return;
    }
    const total = r.timings.reduce((s, t) => s + t.ms, 0);
    this.statsBox.replaceChildren(
      ...busy,
      kv("Brushes / meshes", `${this.host.model.level.brushes.length} / ${this.host.model.level.meshes.length}`),
      kv("Walls", String(r.walls.length)),
      kv("BSP nodes / depth", `${r.bspStats.nodeCount} / ${r.bspStats.maxDepth}`),
      kv("Leaves (empty / solid)", `${r.summary.emptyLeafCount} / ${r.bspStats.solidLeafCount}`),
      kv("Wall splits / refine splits", `${r.bspStats.splitCount} / ${r.bspStats.refineSplitCount}`),
      kv("Portals (directed)", String(r.graph.portals.length)),
      kv("Avg might-see → flow", `${r.summary.averageMightSee.toFixed(1)} → ${r.summary.averagePortalVis.toFixed(1)}`),
      kv("PVS rows (unique / leaves)", `${r.pvsTable.rows.length} / ${r.pvs.length}`),
      kv("Avg visible leaves", `${r.summary.averageVisibleLeaves.toFixed(1)} (${(r.summary.averageVisibleFraction * 100).toFixed(0)}%)`),
      kv("Flow steps", `${r.flowStats.steps}${r.flowStats.truncated ? " (TRUNCATED)" : ""}`),
      ...(r.leaks.leaking ? [h("div", { class: "error" }, `Leak: ${r.leaks.boundaryLeaves.length} empty leaves touch the bounds (${r.leaks.outsideLeaves.length} reachable)`)] : []),
      h("div", { class: "timings" },
        ...r.timings.map((t) => kv(t.stage, `${t.ms.toFixed(1)} ms`)),
        kv("total", `${total.toFixed(1)} ms`)),
    );
  }

  private renderProbe(view: ViewState): void {
    const r = this.host.compiled();
    const p = view.inspect.point;
    if (!r || !p) {
      this.probeBox.replaceChildren(h("span", { class: "muted" }, "Use the Inspect tool, or probe from the camera"));
      return;
    }
    const leaf = locateLeaf(r.tree, p);
    const contents = r.tree.leaves[leaf].contents;
    const rows: HTMLElement[] = [
      kv("Point", `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}${view.inspect.pinned ? " (pinned)" : ""}`),
      kv("Leaf", `L${leaf} (${contents})`),
    ];
    if (contents === "empty") {
      const vis = r.pvs[leaf].toArray();
      rows.push(kv("PVS", `${vis.length} / ${r.summary.emptyLeafCount} leaves`));
      rows.push(h("div", { class: "ids" }, vis.map((i) => `L${i}`).join(" ")));
      rows.push(kv("Portals out", r.graph.portalsFrom[leaf].map((i) => `${i}`).join(", ") || "—"));
    }
    const portalId = view.inspect.portal;
    if (portalId !== null && r.graph.portals[portalId]) {
      const portal = r.graph.portals[portalId];
      rows.push(h("hr"));
      rows.push(kv("Portal", `#${portal.id}: L${portal.from} → L${portal.to}`));
      rows.push(kv("Might see (base vis)", String(r.mightSee[portalId].count())));
      rows.push(kv("Sees (portal flow)", String(r.portalVis[portalId].count())));
    }
    this.probeBox.replaceChildren(...rows);
  }
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", {}, h("h2", {}, title), ...children);
}

function kv(key: string, value: string): HTMLElement {
  return h("div", { class: "kv" }, h("span", { class: "k" }, key), h("span", { class: "v" }, value));
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
  return h("label", { class: "check" }, input, label);
}

function numberInput(value: number, onChange: (v: number) => void, min = 0, step = 0.5): HTMLInputElement {
  return h("input", {
    type: "number", min, step, value,
    onchange: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= min) onChange(v);
    },
  });
}

function numberField(label: string, value: number, onChange: (v: number) => void, title?: string): HTMLElement {
  return h("label", { class: "field", ...(title ? { title } : {}) }, h("span", {}, label), numberInput(value, onChange));
}
