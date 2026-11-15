/**
 * Inspect tool: probe the compiled visibility.
 *
 * - Hover a surface: the probe sits just in front of it; surfaces are coloured
 *   by the probed leaf's PVS, and rays show the exact line of sight.
 * - Click to pin the probe (click again elsewhere to move it, Esc to unpin).
 * - Hover a portal (look through it) to see what that portal can see:
 *   cyan = portal flow result, purple = allowed by base vis but rejected by flow.
 * - "Probe from camera" (panel) uses the camera position instead: fly through
 *   the level with WASD and watch the PVS change.
 */

import { addScaled } from "../../../core";
import type { Tool, ToolContext, ToolPointer } from "./tool";
import { portalAlongRay, surfaceAlongRay } from "../picking";

/** Distance in front of the hovered surface at which the probe is placed. */
const PROBE_LIFT = 0.25;

export class InspectTool implements Tool {
  readonly id = "inspect" as const;
  readonly label = "Inspect";
  readonly shortcut = "i";
  readonly hint = "Hover a surface to probe the PVS · click to pin · Esc to unpin · look through a portal to see its portal vis";
  readonly cursor = "crosshair";

  constructor(private readonly ctx: ToolContext) {}

  deactivate(): void {
    const { inspect } = this.ctx.view;
    if (!inspect.pinned) inspect.point = null;
    inspect.portal = null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const { inspect } = this.ctx.view;
    const point = this.probeAt(p);
    if (point) {
      inspect.point = point;
      inspect.pinned = true;
    }
    this.ctx.requestRender();
  }

  pointerMove(p: ToolPointer): void {
    const { inspect } = this.ctx.view;
    const compiled = this.ctx.compiled();
    const hit = compiled ? surfaceAlongRay(compiled, p.ray) : null;
    if (!inspect.pinned) inspect.point = hit ? addScaled(hit.point, hit.normal, PROBE_LIFT) : null;
    inspect.portal = compiled && this.ctx.view.layers.portals ? portalAlongRay(compiled, p.ray, hit?.t ?? Infinity) : null;
    this.ctx.requestRender();
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === "Escape") {
      this.ctx.view.inspect.pinned = false;
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  private probeAt(p: ToolPointer) {
    const compiled = this.ctx.compiled();
    const hit = compiled ? surfaceAlongRay(compiled, p.ray) : null;
    return hit ? addScaled(hit.point, hit.normal, PROBE_LIFT) : null;
  }
}
