/**
 * 2D canvas drawn on top of the WebGL view, for things WebGL lines can't do
 * well: thick or dashed highlights, handles, dots and text. Draws world-space
 * geometry by projecting it with the camera (no depth test: x-ray).
 */

import type { Vec3, Winding } from "../../core";
import type { Camera } from "../editor/camera";

export interface StrokeStyle {
  readonly color: string;
  readonly width?: number;
  readonly dash?: readonly number[];
}

export class Overlay {
  constructor(readonly ctx: CanvasRenderingContext2D, readonly camera: Camera) {}

  private stroke(style: StrokeStyle): void {
    this.ctx.strokeStyle = style.color;
    this.ctx.lineWidth = style.width ?? 1;
    this.ctx.setLineDash(style.dash ?? []);
    this.ctx.stroke();
  }

  line(a: Vec3, b: Vec3, style: StrokeStyle): void {
    const s = this.camera.projectSegment(a, b);
    if (!s) return;
    this.ctx.beginPath();
    this.ctx.moveTo(s[0].x, s[0].y);
    this.ctx.lineTo(s[1].x, s[1].y);
    this.stroke(style);
  }

  loop(w: Winding, style: StrokeStyle): void {
    for (let i = 0; i < w.length; i++) this.line(w[i], w[(i + 1) % w.length], style);
  }

  /** Line with an arrowhead at `b` (size in pixels). */
  arrow(a: Vec3, b: Vec3, style: StrokeStyle, headPx = 7): void {
    const s = this.camera.projectSegment(a, b);
    if (!s) return;
    this.line(a, b, style);
    const [sa, sb] = s;
    const ang = Math.atan2(sb.y - sa.y, sb.x - sa.x);
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(sb.x, sb.y);
    ctx.lineTo(sb.x - headPx * Math.cos(ang - 0.5), sb.y - headPx * Math.sin(ang - 0.5));
    ctx.lineTo(sb.x - headPx * Math.cos(ang + 0.5), sb.y - headPx * Math.sin(ang + 0.5));
    ctx.closePath();
    ctx.fillStyle = style.color;
    ctx.fill();
  }

  /** Circle with a radius in pixels. */
  dot(p: Vec3, radiusPx: number, fill: string, stroke?: StrokeStyle): void {
    const s = this.camera.project(p);
    if (!s) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) this.stroke(stroke);
  }

  /** Square handle with a half-size in pixels. */
  square(p: Vec3, halfPx: number, fill: string, stroke: StrokeStyle): void {
    const s = this.camera.project(p);
    if (!s) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.rect(s.x - halfPx, s.y - halfPx, halfPx * 2, halfPx * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    this.stroke(stroke);
  }

  /** Text anchored at a world point (centred). */
  text(p: Vec3, text: string, color: string, sizePx = 11): void {
    const s = this.camera.project(p);
    if (!s) return;
    const { ctx } = this;
    ctx.font = `${sizePx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(text, s.x, s.y);
  }
}
