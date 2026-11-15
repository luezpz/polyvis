/**
 * Tool interface. Exactly one tool is active at a time; the canvas controller
 * forwards pointer/keyboard events to it (after handling camera navigation
 * itself).
 */

import type { CompileResult, Vec3 } from "../../../core";
import type { Camera, Ray, ScreenPoint } from "../camera";
import type { EditorModel } from "../model";
import type { ViewState } from "../viewState";
import type { Overlay } from "../../render/overlay";

export type ToolId = "select" | "box" | "polygon" | "inspect";

export interface ToolContext {
  readonly model: EditorModel;
  readonly view: ViewState;
  readonly camera: Camera;
  /** Latest compile result (may lag behind the level while compiling), or null. */
  compiled(): CompileResult | null;
  requestRender(): void;
}

export interface ToolPointer {
  /** Position in canvas CSS pixels. */
  readonly screen: ScreenPoint;
  /** World-space ray under the pointer. */
  readonly ray: Ray;
  /** Where the ray hits the work plane (null if it misses), raw and grid-snapped. */
  readonly work: Vec3 | null;
  readonly workSnapped: Vec3 | null;
  readonly button: number;
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  /** Single-key shortcut (lower case). */
  readonly shortcut: string;
  /** One-line usage hint shown in the status bar. */
  readonly hint: string;
  readonly cursor: string;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(p: ToolPointer): void;
  pointerMove?(p: ToolPointer): void;
  pointerUp?(p: ToolPointer): void;
  doubleClick?(p: ToolPointer): void;
  /** Returns true if the key was handled. */
  keyDown?(e: KeyboardEvent): boolean;
  drawOverlay?(overlay: Overlay): void;
}
