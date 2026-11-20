/**
 * Editor document model: the current level, selection and undo history.
 *
 * Levels are immutable values; every edit produces a new `Level`. Continuous
 * gestures (dragging) use {@link EditorModel.beginGesture} /
 * {@link EditorModel.endGesture} so a whole drag becomes one undo step.
 */

import {
  type Brush, type BrushKind, type Level, type ObjImportResult, type Point2, type Vec3,
  emptyLevel, makeBoxBrush, makeBrush, objDoorBrushes, objMesh, makePrismBrush, moveBrushFace, nextBrushId, nextMeshId, translateBrush, withDetail, withDoor, withFlags,
} from "../../core";
import { History } from "../../../shared/app/editor/history";

export type ModelChange = "level" | "selection";
type Listener = (change: ModelChange) => void;

export class EditorModel {
  private _level: Level = emptyLevel();
  private _selectedId: number | null = null;
  private gestureStart: Level | null = null;
  private readonly history = new History<Level>();
  private readonly listeners = new Set<Listener>();

  /** Kind used for newly created brushes. */
  newBrushKind: BrushKind = "room";

  get level(): Level {
    return this._level;
  }

  get selectedId(): number | null {
    return this._selectedId;
  }

  get selectedBrush(): Brush | null {
    return this._level.brushes.find((b) => b.id === this._selectedId) ?? null;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: ModelChange): void {
    for (const l of this.listeners) l(change);
  }

  /** Replaces the whole level (e.g. on load). Clears history unless `undoable`. */
  loadLevel(level: Level, undoable = false): void {
    if (undoable) this.history.record(this._level);
    else this.history.clear();
    this._level = level;
    this._selectedId = null;
    this.emit("level");
    this.emit("selection");
  }

  select(id: number | null): void {
    if (id === this._selectedId) return;
    this._selectedId = id;
    this.emit("selection");
  }

  /** Applies an edit. Inside a gesture, history is recorded once at the end. */
  private apply(next: Level): void {
    if (next === this._level) return;
    if (!this.gestureStart) this.history.record(this._level);
    this._level = next;
    this.emit("level");
  }

  beginGesture(): void {
    this.gestureStart ??= this._level;
  }

  endGesture(): void {
    if (this.gestureStart && this.gestureStart !== this._level) this.history.record(this.gestureStart);
    this.gestureStart = null;
  }

  private addBrushObject(brush: Brush | null): number | null {
    if (!brush) return null;
    this.apply({ ...this._level, brushes: [...this._level.brushes, brush] });
    this.select(brush.id);
    return brush.id;
  }

  /** Adds an axis-aligned box brush. Returns its id, or null if degenerate. */
  addBox(kind: BrushKind, a: Vec3, b: Vec3): number | null {
    return this.addBrushObject(makeBoxBrush(nextBrushId(this._level), kind, a, b));
  }

  /** Adds a vertical prism (convex hull of the footprint, extruded from z0 to z1). */
  addPrism(kind: BrushKind, footprint: readonly Point2[], z0: number, z1: number): number | null {
    return this.addBrushObject(makePrismBrush(nextBrushId(this._level), kind, footprint, z0, z1));
  }

  /** Replaces a brush. Degenerate results are ignored (the brush keeps its last valid shape). */
  private replaceBrush(id: number, make: (b: Brush) => Brush | null): void {
    let changed = false;
    const brushes = this._level.brushes.map((b) => {
      if (b.id !== id) return b;
      const next = make(b);
      if (!next) return b;
      changed = true;
      return next;
    });
    if (changed) this.apply({ ...this._level, brushes });
  }

  setKind(id: number, kind: BrushKind): void {
    this.replaceBrush(id, (b) => { const n = makeBrush(b.id, kind, b.planes); return n && withFlags(n, b); });
  }

  /** Flags a solid brush as detail (non-cutting) or structural. */
  setDetail(id: number, detail: boolean): void {
    this.replaceBrush(id, (b) => withDetail(b, detail));
  }

  /** Makes a solid brush a door named `name` (phase 4b), or not a door (`null` / empty). */
  setDoor(id: number, name: string | null): void {
    this.replaceBrush(id, (b) => withDoor(b, name || undefined));
  }

  /** Moves a brush to `original` translated by `delta` (gesture-friendly: always relative to the original). */
  translateBrush(id: number, original: Brush, delta: Vec3): void {
    this.replaceBrush(id, () => translateBrush(original, delta));
  }

  /** Pushes face `index` of `original` outwards by `offset`. */
  moveFace(id: number, original: Brush, index: number, offset: number): void {
    this.replaceBrush(id, () => moveBrushFace(original, index, offset));
  }

  removeBrush(id: number): void {
    this.apply({ ...this._level, brushes: this._level.brushes.filter((b) => b.id !== id) });
    if (this._selectedId === id) this.select(null);
  }

  duplicateBrush(id: number, offset: Vec3): void {
    const b = this._level.brushes.find((x) => x.id === id);
    if (!b) return;
    const moved = translateBrush(b, offset);
    const copy = moved && makeBrush(nextBrushId(this._level), b.kind, moved.planes);
    if (copy) this.addBrushObject(withFlags(copy, b));
  }

  /**
   * Adds an imported OBJ: its mesh (hint biases included) and its `door_<name>` volumes as door
   * brushes, in one undo step. Returns the door names that gave no volume (skipped).
   */
  addObj(name: string, obj: ObjImportResult): string[] {
    const { brushes, failed } = objDoorBrushes(obj.doors, nextBrushId(this._level));
    const mesh = objMesh(obj, nextMeshId(this._level), name);
    this.apply({ ...this._level, brushes: [...this._level.brushes, ...brushes], meshes: [...this._level.meshes, mesh] });
    return failed;
  }

  removeMeshes(): void {
    if (this._level.meshes.length) this.apply({ ...this._level, meshes: [] });
  }

  undo(): void {
    const prev = this.history.undo(this._level);
    if (prev) {
      this._level = prev;
      if (!prev.brushes.some((b) => b.id === this._selectedId)) this._selectedId = null;
      this.emit("level");
      this.emit("selection");
    }
  }

  redo(): void {
    const next = this.history.redo(this._level);
    if (next) {
      this._level = next;
      this.emit("level");
    }
  }
}
