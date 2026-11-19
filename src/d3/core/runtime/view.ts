/** 3D camera constructor for runtime clipping (Z-up). */

import type { View } from "../../../shared/core";
import type { Dim3 } from "../geometry";
import { type Vec3, cross, normalize } from "../math";

/**
 * Camera looking along `dir`; screen axes right = dir × up, up' = right × dir (unit). `tanX`, `tanY`:
 * tangents of the half fields of view (default 1 = 90°). `dir` must not be parallel to `up`.
 */
export function viewToward(dir: Vec3, tanX = 1, tanY = 1, up: Vec3 = { x: 0, y: 0, z: 1 }): View<Dim3> {
  const forward = normalize(dir);
  const right = normalize(cross(forward, up));
  return { forward, axes: [right, cross(right, forward)], rect: { min: [-tanX, -tanY], max: [tanX, tanY] } };
}
