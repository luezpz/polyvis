/**
 * Side panel: tools, work plane, level actions, layer toggles, compiler
 * options, stats and probe read-outs. Static controls are built once;
 * {@link Panel.update} refreshes the parts that depend on state.
 */

import {
  type BrushKind, type CompileOptions, type CompileResult,
  DEFAULT_BSP_OPTIONS, ALL_LEVELS, brushVolume, locateLeaf,
} from "../../core";
import type { EditorModel } from "../editor/model";
import { type Layers, LAYER_LABELS, type ViewState } from "../editor/viewState";
import type { Tool, ToolId } from "../editor/tools/tool";
import { h } from "../../../shared/app/ui/dom";
import { checkbox, doorNameInput, kv, levelSelect, numberInput, section } from "../../../shared/app/ui/widgets";
import { compilerOptionsSection, exportButtons, probeRows, statsRows } from "../../../shared/app/ui/compileSections";

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

    const sampleSelect = levelSelect(ALL_LEVELS);
    const level = h("div", { class: "stack" },
      h("div", { class: "button-row" },
        sampleSelect,
        h("button", { onclick: () => host.loadSample(Number(sampleSelect.value)) }, "Load"),
      ),
      h("div", { class: "button-row" },
        h("button", { onclick: () => host.newLevel() }, "New"),
        h("button", { onclick: () => host.openLevel() }, "Open…"),
        h("button", { onclick: () => host.saveLevel() }, "Save…"),
        this.undoButton,
        this.redoButton,
      ),
      exportButtons(() => host.exportPvsJson(), () => host.exportPvsText()),
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

    const compiler = compilerOptionsSection(() => host.options, (o) => host.setOptions(o), DEFAULT_BSP_OPTIONS);

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
      kv("Brush", `#${b.id} (${b.kind}${b.kind === "solid" && b.detail ? ", detail" : ""}${b.kind === "solid" && b.door ? `, door "${b.door}"` : ""})`),
      kv("Faces / volume", `${b.faces.length} / ${f(brushVolume(b))}`),
      kv("Min", `${f(min.x)}, ${f(min.y)}, ${f(min.z)}`),
      kv("Max", `${f(max.x)}, ${f(max.y)}, ${f(max.z)}`),
      h("div", { class: "button-row" },
        h("button", { onclick: () => model.setKind(b.id, b.kind === "room" ? "solid" : "room") }, "Toggle kind"),
        b.kind === "solid" ? h("button", { onclick: () => model.setDetail(b.id, !b.detail), title: "Detail brushes are drawn but do not cut the BSP or block visibility" }, b.detail ? "Make structural" : "Make detail") : null,
        b.kind === "solid" ? h("button", { onclick: () => model.setDoor(b.id, b.door ? null : `door${b.id}`), title: "Door brushes are drawn but do not cut the BSP; the runtime query closes their portals while the door is shut" }, b.door ? "Not a door" : "Make door") : null,
        h("button", { onclick: () => model.duplicateBrush(b.id, { x: g, y: -g, z: 0 }) }, "Duplicate"),
        h("button", { onclick: () => { view.workZ = f(b.bounds.min.z); this.host.requestRender(); }, title: "Put the work plane at this brush's floor" }, "Work plane → floor"),
        h("button", { class: "danger", onclick: () => model.removeBrush(b.id) }, "Delete"),
      ),
      ...(b.kind === "solid" && b.door ? [doorNameInput(b.door, (name) => model.setDoor(b.id, name))] : []),
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
    this.statsBox.replaceChildren(...statsRows(this.host.compiled(), this.host.compileError(), this.host.compiling, [kv("Brushes / meshes", `${this.host.model.level.brushes.length} / ${this.host.model.level.meshes.length}`)]));
  }

  private renderProbe(view: ViewState): void {
    const r = this.host.compiled();
    const p = view.inspect.point;
    if (!r || !p) {
      this.probeBox.replaceChildren(h("span", { class: "muted" }, "Use the Inspect tool, or probe from the camera"));
      return;
    }
    this.probeBox.replaceChildren(
      kv("Point", `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}${view.inspect.pinned ? " (pinned)" : ""}`),
      ...probeRows(r, locateLeaf(r.tree, p), view.inspect.portal),
    );
  }
}
