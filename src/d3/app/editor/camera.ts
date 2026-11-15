/**
 * Orbit camera (Z-up): looks at `target` from `distance` away, at angle
 * `yaw` around Z and elevation `pitch`. Moving the target (WASD) turns it into
 * a fly camera; with a small distance it behaves like a first-person view.
 *
 * Screen coordinates are canvas CSS pixels, y down.
 */

import { type Aabb, type Vec3, add, addScaled, aabbCenter, aabbDiagonal, cross, dot, normalize, scale, sub } from "../../core";
import { type Mat4, lookAt, multiply, perspective } from "../render/mat4";

export interface Ray {
  readonly origin: Vec3;
  /** Unit direction. */
  readonly dir: Vec3;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

const Z_UP: Vec3 = { x: 0, y: 0, z: 1 };

export class Camera {
  target: Vec3 = { x: 0, y: 0, z: 0 };
  yaw = -2.3;
  pitch = 0.65;
  distance = 40;
  readonly fovY = (60 * Math.PI) / 180;
  readonly near = 0.05;
  readonly far = 20000;
  /** Viewport size in CSS pixels. */
  width = 1;
  height = 1;

  static readonly MIN_DISTANCE = 0.2;
  static readonly MAX_DISTANCE = 5000;

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  get aspect(): number {
    return this.width / this.height;
  }

  get eye(): Vec3 {
    const c = Math.cos(this.pitch);
    return addScaled(this.target, { x: c * Math.cos(this.yaw), y: c * Math.sin(this.yaw), z: Math.sin(this.pitch) }, this.distance);
  }

  /** Unit forward / right / up vectors of the view. */
  basis(): { forward: Vec3; right: Vec3; up: Vec3 } {
    const forward = normalize(sub(this.target, this.eye));
    const right = normalize(cross(forward, Z_UP));
    return { forward, right, up: cross(right, forward) };
  }

  viewProjection(): Mat4 {
    return multiply(perspective(this.fovY, this.aspect, this.near, this.far), lookAt(this.eye, this.target, Z_UP));
  }

  /** World-space ray through a screen point. */
  ray(p: ScreenPoint): Ray {
    const { forward, right, up } = this.basis();
    const t = Math.tan(this.fovY / 2);
    const x = ((2 * p.x) / this.width - 1) * t * this.aspect;
    const y = (1 - (2 * p.y) / this.height) * t;
    return { origin: this.eye, dir: normalize(add(forward, add(scale(right, x), scale(up, y)))) };
  }

  /** Screen position of a world point and its view depth, or null if behind the near plane. */
  project(p: Vec3): (ScreenPoint & { depth: number }) | null {
    const { forward, right, up } = this.basis();
    const v = sub(p, this.eye);
    const depth = dot(v, forward);
    if (depth < this.near) return null;
    return this.projectView(dot(v, right), dot(v, up), depth);
  }

  /** Projects a world segment, clipped to the near plane. Null if entirely behind the camera. */
  projectSegment(a: Vec3, b: Vec3): [ScreenPoint, ScreenPoint] | null {
    const { forward, right, up } = this.basis();
    const eye = this.eye;
    const va = sub(a, eye), vb = sub(b, eye);
    let za = dot(va, forward), zb = dot(vb, forward);
    let xa = dot(va, right), ya = dot(va, up), xb = dot(vb, right), yb = dot(vb, up);
    const n = this.near;
    if (za < n && zb < n) return null;
    if (za < n) {
      const t = (n - za) / (zb - za);
      xa += (xb - xa) * t; ya += (yb - ya) * t; za = n;
    } else if (zb < n) {
      const t = (n - zb) / (za - zb);
      xb += (xa - xb) * t; yb += (ya - yb) * t; zb = n;
    }
    return [this.projectView(xa, ya, za), this.projectView(xb, yb, zb)];
  }

  private projectView(x: number, y: number, depth: number): ScreenPoint & { depth: number } {
    const t = Math.tan(this.fovY / 2);
    const nx = x / (depth * t * this.aspect);
    const ny = y / (depth * t);
    return { x: ((nx + 1) / 2) * this.width, y: ((1 - ny) / 2) * this.height, depth };
  }

  /** World length covered by `px` pixels at the depth of `at`. */
  pixelsToWorld(px: number, at: Vec3): number {
    const depth = Math.max(this.near, dot(sub(at, this.eye), this.basis().forward));
    return (px * 2 * depth * Math.tan(this.fovY / 2)) / this.height;
  }

  orbit(dxPx: number, dyPx: number): void {
    this.yaw -= dxPx * 0.006;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dyPx * 0.006));
  }

  /** Pans by a screen-space drag (the point under the cursor follows it, at the target's depth). */
  pan(dxPx: number, dyPx: number): void {
    const { right, up } = this.basis();
    const s = this.pixelsToWorld(1, this.target);
    this.target = addScaled(addScaled(this.target, right, -dxPx * s), up, dyPx * s);
  }

  dolly(factor: number): void {
    this.distance = Math.min(Camera.MAX_DISTANCE, Math.max(Camera.MIN_DISTANCE, this.distance * factor));
  }

  /** Moves the whole camera rig: along the view direction, sideways, and along world Z. */
  fly(forwardAmount: number, rightAmount: number, upAmount: number): void {
    const { forward, right } = this.basis();
    this.target = addScaled(addScaled(addScaled(this.target, forward, forwardAmount), right, rightAmount), Z_UP, upAmount);
  }

  /** Frames a world-space box. */
  fit(box: Aabb): void {
    this.target = aabbCenter(box);
    const radius = Math.max(1, aabbDiagonal(box) / 2);
    const halfFov = Math.min(this.fovY, this.fovY * this.aspect) / 2;
    this.distance = Math.min(Camera.MAX_DISTANCE, (radius / Math.sin(halfFov)) * 1.05);
  }
}

/** Intersection of a ray with the horizontal plane z = `z` (null if parallel or behind). */
export function rayPlaneZ(ray: Ray, z: number): Vec3 | null {
  if (Math.abs(ray.dir.z) < 1e-9) return null;
  const t = (z - ray.origin.z) / ray.dir.z;
  return t > 0 ? addScaled(ray.origin, ray.dir, t) : null;
}

/** Intersection of a ray with an arbitrary plane through `point` with normal `n` (null if parallel or behind). */
export function rayPlane(ray: Ray, point: Vec3, n: Vec3): Vec3 | null {
  const denom = dot(n, ray.dir);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(n, sub(point, ray.origin)) / denom;
  return t > 0 ? addScaled(ray.origin, ray.dir, t) : null;
}

/** Parameter `t` of the point on the line `p + n·t` closest to the ray (null if nearly parallel). */
export function closestOnLine(ray: Ray, p: Vec3, n: Vec3): number | null {
  const w0 = sub(p, ray.origin);
  const b = dot(n, ray.dir);
  const denom = 1 - b * b;
  if (denom < 1e-6) return null;
  const d = dot(n, w0), e = dot(ray.dir, w0);
  return (b * e - d) / denom;
}
