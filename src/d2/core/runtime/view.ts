/** 2D camera constructor for runtime clipping. */

import type { View } from "../../../shared/core";
import type { Dim2 } from "../geometry";
import { type Vec2, normalize, perpLeft } from "../math";

/** Camera looking along `dir` with half field of view `atan(halfTan)` (default 45°); screen axis = left of `dir`. */
export function viewToward(dir: Vec2, halfTan = 1): View<Dim2> {
  const forward = normalize(dir);
  return { forward, axes: [perpLeft(forward)], rect: { min: [-halfTan], max: [halfTan] } };
}
