import { describe, expect, it } from "vitest";
import { bvhAnyAt, bvhQueryBox, buildBvh, rng } from "../../src/shared/core";

/** Random boxes, `n` rows of `[min k, max k]`. */
function randomBoxes(rand: () => number, n: number, k: number): Float64Array {
  const out = new Float64Array(n * 2 * k);
  for (let i = 0; i < n; i++)
    for (let a = 0; a < k; a++) {
      const lo = rand() * 100, size = rand() * 10;
      out[i * 2 * k + a] = lo;
      out[i * 2 * k + k + a] = lo + size;
    }
  return out;
}

/** Brute force: indices of boxes overlapping `[min − eps, max + eps]`, ascending. */
function bruteBox(boxes: Float64Array, k: number, min: number[], max: number[], eps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < boxes.length / (2 * k); i++) {
    let ok = true;
    for (let a = 0; a < k; a++) if (boxes[i * 2 * k + a] > max[a] + eps || boxes[i * 2 * k + k + a] < min[a] - eps) ok = false;
    if (ok) out.push(i);
  }
  return out;
}

describe("BVH", () => {
  for (const k of [2, 3]) {
    it(`box queries match brute force (${k}D)`, () => {
      const rand = rng(k);
      for (const n of [0, 1, 3, 5, 17, 300]) {
        const boxes = randomBoxes(rand, n, k);
        const bvh = buildBvh(boxes, k);
        for (let q = 0; q < 50; q++) {
          const min = Array.from({ length: k }, () => rand() * 100);
          const max = min.map((m) => m + rand() * 20);
          const eps = q % 2 ? 0.5 : 0;
          expect(bvhQueryBox(bvh, boxes, min, max, eps)).toEqual(bruteBox(boxes, k, min, max, eps));
          const p = min;
          const hits = bruteBox(boxes, k, p, p, eps);
          expect(bvhAnyAt(bvh, boxes, p, eps, () => true)).toBe(hits.length > 0);
          expect(bvhAnyAt(bvh, boxes, p, eps, (i) => i === hits[hits.length - 1])).toBe(hits.length > 0);
        }
      }
    });
  }
});
