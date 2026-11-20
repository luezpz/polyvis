/**
 * Application shell: owns the model, view state, camera, tools, renderer and
 * panel; routes input; recompiles the level (in a Web Worker) whenever it
 * changes.
 */

import {
  type Aabb, type CompileOptions, type CompileResult,
  DEFAULT_COMPILE_OPTIONS, SAMPLE_LEVELS, ALL_LEVELS, aabbFromPoints, brushVertices, emptyLevel, exportPvsJson, exportPvsText,
  importObj, locateLeaf, parseLevel, serializeLevel,
} from "../core";
import { Camera, type ScreenPoint, rayPlaneZ } from "./editor/camera";
import { EditorModel } from "./editor/model";
import { ViewState } from "./editor/viewState";
import type { Tool, ToolContext, ToolId, ToolPointer } from "./editor/tools/tool";
import { SelectTool } from "./editor/tools/selectTool";
import { BoxTool } from "./editor/tools/boxTool";
import { PolygonTool } from "./editor/tools/polygonTool";
import { InspectTool } from "./editor/tools/inspectTool";
import { type Probe, Renderer } from "./render/renderer";
import { Panel, type PanelHost } from "./ui/panel";
import { downloadText, pickFile, pickTextFile } from "../../shared/app/ui/dom";
import { createCompileClient } from "./compile/compiler";

const AUTOSAVE_KEY = "polyvis3d.level.v1";
const FLY_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]);

type CameraDrag = { pointerId: number; mode: "orbit" | "pan"; last: ScreenPoint };

export class App implements PanelHost, ToolContext {
  readonly model = new EditorModel();
  readonly view = new ViewState();
  readonly camera = new Camera();
  readonly tools: readonly Tool[];
  options: CompileOptions = { ...DEFAULT_COMPILE_OPTIONS, bsp: {}, flow: {} };

  private _activeTool: Tool;
  private readonly renderer: Renderer;
  private readonly panel: Panel;
  private readonly compiler: ReturnType<typeof createCompileClient>;
  private result: CompileResult | null = null;
  private error: string | null = null;
  private frameRequested = false;
  private cameraDrag: CameraDrag | null = null;
  private spaceHeld = false;
  private readonly flyKeys = new Set<string>();
  private flyShift = false;
  private lastFlyTime: number | null = null;
  private cursor: ScreenPoint | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, panelRoot: HTMLElement, private readonly status: HTMLElement) {
    this.tools = [new SelectTool(this), new BoxTool(this), new PolygonTool(this), new InspectTool(this)];
    this._activeTool = this.tools[0];
    this.renderer = new Renderer(canvas, overlay, this.camera);
    this.compiler = createCompileClient((result, error) => {
      if (result) this.result = result;
      this.error = error;
      this.requestRender();
    });
    this.panel = new Panel(panelRoot, this);

    this.model.onChange((change) => {
      if (change === "level") {
        this.scheduleCompile();
        this.autosave();
      }
      this.requestRender();
    });

    this.bindInput();
    new ResizeObserver(() => {
      this.renderer.resize();
      this.requestRender();
    }).observe(canvas);
    this.renderer.resize();

    this.model.loadLevel(this.restore() ?? SAMPLE_LEVELS[0].create());
    this.fitView();
  }

  // ---- PanelHost / ToolContext -------------------------------------------

  get activeTool(): Tool {
    return this._activeTool;
  }

  get compiling(): boolean {
    return this.compiler.busy;
  }

  compiled(): CompileResult | null {
    return this.result;
  }

  compileError(): string | null {
    return this.error;
  }

  setTool(id: ToolId): void {
    const next = this.tools.find((t) => t.id === id);
    if (!next || next === this._activeTool) return;
    this._activeTool.deactivate?.();
    this._activeTool = next;
    next.activate?.();
    this.canvas.style.cursor = next.cursor;
    this.requestRender();
  }

  setOptions(options: Partial<CompileOptions>): void {
    this.options = { ...this.options, ...options };
    this.scheduleCompile();
  }

  requestRender(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame((time) => {
      this.frameRequested = false;
      this.stepFly(time);
      this.renderer.draw({
        level: this.model.level,
        selectedId: this.model.selectedId,
        compiled: this.result,
        view: this.view,
        tool: this._activeTool,
        probe: this.currentProbe(),
      });
      this.panel.update();
      this.updateStatus();
    });
  }

  newLevel(): void {
    this.model.loadLevel(emptyLevel(), true);
  }

  loadSample(index: number): void {
    const sample = ALL_LEVELS[index];
    if (!sample) return;
    this.model.loadLevel(sample.create(), true);
    this.view.clearProbe();
    this.fitView();
  }

  async openLevel(): Promise<void> {
    const text = await pickTextFile();
    if (text === null) return;
    try {
      this.model.loadLevel(parseLevel(text), true);
      this.fitView();
    } catch (e) {
      alert(`Could not open level: ${(e as Error).message}`);
    }
  }

  saveLevel(): void {
    downloadText("level.polyvis3d.json", serializeLevel(this.model.level));
  }

  async importObj(options: { flipNormals: boolean; yUp: boolean; scale: number }): Promise<void> {
    const file = await pickFile(".obj,text/plain");
    if (!file) return;
    try {
      const obj = importObj(await file.text(), options);
      const { faces, faceSplitBias, doors, triangleCount, skipped } = obj;
      if (faces.length === 0) throw new Error("no usable faces found");
      const failed = this.model.addObj(file.name, obj);
      console.info(`Imported ${file.name}: ${triangleCount} triangles → ${faces.length} faces (${skipped} skipped), ${faceSplitBias?.filter((b) => b !== 0).length ?? 0} hint faces, ${doors.length} doors`);
      if (failed.length) alert(`Door meshes with no closed convex volume (skipped): ${failed.join(", ")}`);
      this.fitView();
    } catch (e) {
      alert(`Could not import OBJ: ${(e as Error).message}`);
    }
  }

  exportPvsJson(): void {
    if (this.result) downloadText("level.pvs.json", exportPvsJson(this.result));
  }

  exportPvsText(): void {
    if (this.result) downloadText("level.pvs.txt", exportPvsText(this.result), "text/plain");
  }

  fitView(): void {
    const box = this.levelBounds();
    if (box) this.camera.fit(box);
    else {
      this.camera.target = { x: 0, y: 0, z: 0 };
      this.camera.distance = 30;
    }
    this.requestRender();
  }

  // ---- Compilation & persistence -----------------------------------------

  private scheduleCompile(): void {
    this.compiler.request(this.model.level, this.options);
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeLevel(this.model.level));
    } catch {
      // Storage may be unavailable (private mode, quota); autosave is best-effort.
    }
  }

  private restore(): ReturnType<typeof parseLevel> | null {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      return text ? parseLevel(text) : null;
    } catch {
      return null;
    }
  }

  private levelBounds(): Aabb | null {
    const { brushes, meshes } = this.model.level;
    return aabbFromPoints([...brushes.flatMap(brushVertices), ...meshes.flatMap((m) => m.faces.flat())]);
  }

  /** The probed point and its (empty) leaf, from the camera or the inspect tool. */
  private currentProbe(): Probe | null {
    const r = this.result;
    const { inspect } = this.view;
    if (inspect.fromCamera) inspect.point = this.camera.eye;
    if (!r || !inspect.point) return null;
    const leaf = locateLeaf(r.tree, inspect.point);
    if (r.tree.leaves[leaf].contents !== "empty") return null;
    if (!inspect.fromCamera) return { point: inspect.point, leaf };
    // Probing from the camera: runtime clipping uses the real view (screen rect = tangents of the half fov).
    const { forward, right, up } = this.camera.basis();
    const ty = Math.tan(this.camera.fovY / 2), tx = ty * this.camera.aspect;
    return { point: inspect.point, leaf, view: { forward, axes: [right, up], rect: { min: [-tx, -ty], max: [tx, ty] } } };
  }

  // ---- Input -------------------------------------------------------------

  private toolPointer(e: PointerEvent | MouseEvent): ToolPointer {
    const rect = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const ray = this.camera.ray(screen);
    const work = rayPlaneZ(ray, this.view.workZ);
    const workSnapped = work ? { x: this.view.snapValue(work.x), y: this.view.snapValue(work.y), z: this.view.workZ } : null;
    return { screen, ray, work, workSnapped, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const p = this.toolPointer(e);
      const orbit = e.button === 2 && !e.shiftKey || (e.button === 0 && (e.altKey || this.spaceHeld));
      const pan = e.button === 1 || (e.button === 2 && e.shiftKey);
      if (orbit || pan) {
        this.cameraDrag = { pointerId: e.pointerId, mode: orbit ? "orbit" : "pan", last: p.screen };
        c.style.cursor = orbit ? "grabbing" : "move";
        return;
      }
      this._activeTool.pointerDown?.(p);
      this.requestRender();
    });

    c.addEventListener("pointermove", (e) => {
      const p = this.toolPointer(e);
      this.cursor = p.screen;
      const drag = this.cameraDrag;
      if (drag && drag.pointerId === e.pointerId) {
        const dx = p.screen.x - drag.last.x, dy = p.screen.y - drag.last.y;
        if (drag.mode === "orbit") this.camera.orbit(dx, dy);
        else this.camera.pan(dx, dy);
        drag.last = p.screen;
      } else {
        this._activeTool.pointerMove?.(p);
      }
      this.requestRender();
    });

    const endPointer = (e: PointerEvent) => {
      if (this.cameraDrag && this.cameraDrag.pointerId === e.pointerId) {
        this.cameraDrag = null;
        c.style.cursor = this._activeTool.cursor;
        return;
      }
      this._activeTool.pointerUp?.(this.toolPointer(e));
      this.requestRender();
    };
    c.addEventListener("pointerup", endPointer);
    c.addEventListener("pointercancel", endPointer);

    c.addEventListener("dblclick", (e) => this._activeTool.doubleClick?.(this.toolPointer(e)));

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.dolly(Math.exp(e.deltaY * 0.0015));
      this.requestRender();
    }, { passive: false });

    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.spaceHeld = false;
      this.flyKeys.delete(e.code);
      this.flyShift = e.shiftKey;
    });
    window.addEventListener("blur", () => {
      this.flyKeys.clear();
      this.spaceHeld = false;
    });
  }

  private onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    const ctrl = e.ctrlKey || e.metaKey;

    if (e.code === "Space") {
      this.spaceHeld = true;
      e.preventDefault();
      return;
    }
    if (!ctrl && FLY_KEYS.has(e.code)) {
      this.flyKeys.add(e.code);
      this.flyShift = e.shiftKey;
      this.lastFlyTime = null;
      e.preventDefault();
      this.requestRender();
      return;
    }
    if (this._activeTool.keyDown?.(e)) {
      e.preventDefault();
      this.requestRender();
      return;
    }
    const key = e.key.toLowerCase();
    if (ctrl && key === "z") {
      if (e.shiftKey) this.model.redo();
      else this.model.undo();
    } else if (ctrl && key === "y") {
      this.model.redo();
    } else if (ctrl) {
      return; // leave other browser shortcuts alone
    } else if (key === "k") {
      const sel = this.model.selectedBrush;
      if (sel && this._activeTool.id === "select") this.model.setKind(sel.id, sel.kind === "room" ? "solid" : "room");
      else this.model.newBrushKind = this.model.newBrushKind === "room" ? "solid" : "room";
    } else if (key === "f") {
      this.fitView();
    } else if (key === "[" || e.key === "PageDown") {
      this.view.workZ = +(this.view.workZ - (this.view.gridSize || 1)).toFixed(6);
    } else if (key === "]" || e.key === "PageUp") {
      this.view.workZ = +(this.view.workZ + (this.view.gridSize || 1)).toFixed(6);
    } else {
      const tool = this.tools.find((t) => t.shortcut === key);
      if (!tool) return;
      this.setTool(tool.id);
    }
    e.preventDefault();
    this.requestRender();
  }

  /** Advances the WASD/QE fly movement; keeps rendering while keys are held. */
  private stepFly(time: number): void {
    if (this.flyKeys.size === 0) {
      this.lastFlyTime = null;
      return;
    }
    const dt = this.lastFlyTime === null ? 1 / 60 : Math.min(0.1, (time - this.lastFlyTime) / 1000);
    this.lastFlyTime = time;
    const speed = Math.min(60, Math.max(3, this.camera.distance * 0.6)) * (this.flyShift ? 3 : 1) * dt;
    const k = (code: string) => (this.flyKeys.has(code) ? 1 : 0);
    this.camera.fly((k("KeyW") - k("KeyS")) * speed, (k("KeyD") - k("KeyA")) * speed, (k("KeyE") - k("KeyQ")) * speed);
    queueMicrotask(() => this.requestRender());
  }

  private updateStatus(): void {
    let pos = "—";
    if (this.cursor) {
      const w = rayPlaneZ(this.camera.ray(this.cursor), this.view.workZ);
      if (w) pos = `${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${this.view.workZ.toFixed(2)}`;
    }
    const kind = this.model.newBrushKind;
    this.status.textContent = `${pos}  ·  ${this._activeTool.label} (${kind}, work plane z=${this.view.workZ})  ·  ${this._activeTool.hint}`;
  }
}
