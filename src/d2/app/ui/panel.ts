/**
 * Side panel: tools, level actions, layer toggles, compiler options, stats
 * and probe read-outs. Static controls are built once; {@link Panel.update}
 * refreshes the parts that depend on state.
 */

import { type BrushKind, type CompileOptions, type CompileResult, DEFAULT_BSP_OPTIONS, SAMPLE_LEVELS, locateLeaf } from "../../core";
import type { EditorModel } from "../editor/model";
import { type Layers, LAYER_LABELS, type ViewState } from "../editor/viewState";
import type { Tool, ToolId } from "../editor/tools/tool";
import { h } from "../../../shared/app/ui/dom";
import { checkbox, kv, section } from "../../../shared/app/ui/widgets";
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
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;

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
      exportButtons(() => host.exportPvsJson(), () => host.exportPvsText()),
    );

    const gridSelect = h("select", { onchange: (e: Event) => { view.gridSize = Number((e.target as HTMLSelectElement).value); host.requestRender(); } },
      ...[0.25, 0.5, 1, 2, 4].map((g) => h("option", { value: g, selected: g === view.gridSize }, `${g}`)));
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

    root.append(
      h("header", {}, h("h1", {}, "polyvis ", h("span", { class: "tag" }, "2D")), h("p", {}, "CSG → BSP → portals → portal flow → PVS")),
      section("Tools", tools, h("div", { class: "hint" }, "New brushes are:"), kinds),
      section("Selection", this.selectionBox),
      section("Level", level),
      section("Snapping", snap),
      section("Layers", layers),
      section("Compiler", compiler),
      section("Stats", this.statsBox),
      section("Probe", this.probeBox),
      section("Shortcuts", h("div", { class: "hint" },
        "Wheel zoom · middle/right drag or Space+drag pan · F fit · K toggle room/solid · Ctrl+Z/Y undo/redo")),
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
    this.renderSelection();
    this.renderStats();
    this.renderProbe(view);
  }

  private renderSelection(): void {
    const { model } = this.host;
    const b = model.selectedBrush;
    if (!b) {
      this.selectionBox.replaceChildren(h("span", { class: "muted" }, "Nothing selected"));
      return;
    }
    this.selectionBox.replaceChildren(
      kv("Brush", `#${b.id} (${b.kind})`),
      kv("Vertices", String(b.vertices.length)),
      h("div", { class: "button-row" },
        h("button", { onclick: () => model.updateBrush(b.id, { kind: b.kind === "room" ? "solid" : "room" }) }, "Toggle kind"),
        h("button", { onclick: () => model.bringToFront(b.id) }, "To front"),
        h("button", { onclick: () => model.duplicateBrush(b.id, { x: 1, y: -1 }) }, "Duplicate"),
        h("button", { class: "danger", onclick: () => model.removeBrush(b.id) }, "Delete"),
      ),
    );
  }

  private renderStats(): void {
    this.statsBox.replaceChildren(...statsRows(this.host.compiled(), this.host.compileError(), this.host.compiling, [kv("Brushes", String(this.host.model.level.brushes.length))]));
  }

  private renderProbe(view: ViewState): void {
    const r = this.host.compiled();
    const p = view.inspect.point;
    if (!r || !p) {
      this.probeBox.replaceChildren(h("span", { class: "muted" }, "Use the Inspect tool to probe visibility"));
      return;
    }
    this.probeBox.replaceChildren(
      kv("Point", `${p.x.toFixed(2)}, ${p.y.toFixed(2)}${view.inspect.pinned ? " (pinned)" : ""}`),
      ...probeRows(r, locateLeaf(r.tree, p), view.inspect.portal),
    );
  }
}
