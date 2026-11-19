/**
 * Phase 6b: the 2D flow primitives on flat arrays ({@link FlatFlowKernel}); facets are segments
 * (n = 2, `[ax, ay, bx, by]`), planes lines `[nx, ny, d]`. Same arithmetic, in the same order, as
 * `clipSegmentFront` (math/segment.ts) and `buildSeparators` / `clipToLines` (vis/antipenumbra.ts),
 * so results are bit-identical; checked in tests/shared/flatFlow.test.ts.
 */

import { type FlatFlowKernel, MIN_LENGTH_SQ, PLANE_EPSILON } from "../../../shared/core";

// Read once: under Vite's module runner (bench, tests) every import read is a getter chain through the barrels.
const MIN_LENGTH_SQ_ = MIN_LENGTH_SQ;
const PLANE_EPSILON_ = PLANE_EPSILON;

/**
 * `clipSegmentFront(segment W[wo..wo+4), line (nx, ny, d))`, line already signed.
 * @returns 2 (written at `O[oo ..]`), 0 if gone, −2 if unchanged.
 */
function clipRaw(W: Float64Array, wo: number, nx: number, ny: number, d: number, O: Float64Array, oo: number): number {
  const eps = PLANE_EPSILON_; // local: imports are getters under Vite's runner
  const ax = W[wo], ay = W[wo + 1], bx = W[wo + 2], by = W[wo + 3];
  const da = nx * ax + ny * ay - d;
  const db = nx * bx + ny * by - d;
  if (da <= eps && db <= eps) return 0; // fully behind or on
  if (da >= -eps && db >= -eps) return -2; // fully in front (touching allowed)
  const t = da / (da - db);
  const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
  let x0, y0, x1, y1;
  if (da > 0) { x0 = ax; y0 = ay; x1 = px; y1 = py; } else { x0 = px; y0 = py; x1 = bx; y1 = by; }
  const dx = x0 - x1, dy = y0 - y1;
  if (dx * dx + dy * dy < MIN_LENGTH_SQ_) return 0;
  O[oo] = x0; O[oo + 1] = y0; O[oo + 2] = x1; O[oo + 3] = y1;
  return 2;
}

/** `buildSeparators(from, to)` as lines at `S[so + 3·i ..]`; returns the count (≤ 4). */
function separators2(F: Float64Array, fo: number, T: Float64Array, to: number, S: Float64Array, so: number): number {
  const eps = PLANE_EPSILON_, minLenSq = MIN_LENGTH_SQ_;
  let count = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const p = fo + 2 * i, q = to + 2 * j;
      const px = F[p], py = F[p + 1];
      const ex = T[q] - px, ey = T[q + 1] - py;
      const lenSq = ex * ex + ey * ey;
      if (lenSq < minLenSq) continue; // shared vertex: no separator through it
      const len = Math.sqrt(lenSq);
      if (!(len > 0)) continue;
      const nx = -ey / len, ny = ex / len;
      if (nx === 0 && ny === 0) continue;
      const d = nx * px + ny * py;
      const f = fo + 2 * (1 - i), t = to + 2 * (1 - j);
      const dFrom = nx * F[f] + ny * F[f + 1] - d;
      const dTo = nx * T[t] + ny * T[t + 1] - d;
      const o = so + 3 * count;
      if (dFrom < -eps && dTo > eps) { S[o] = nx; S[o + 1] = ny; S[o + 2] = d; count++; }
      else if (dFrom > eps && dTo < -eps) { S[o] = -nx; S[o + 1] = -ny; S[o + 2] = -d; count++; }
    }
  }
  return count;
}

const sepScratch = new Float64Array(12);
const pingA = new Float64Array(4), pingB = new Float64Array(4);

/** `clipToLines`: clips segment `(W, wo)` by `count` lines at `S[so ..]`; result as {@link clipRaw}. */
function clipChain(W: Float64Array, wo: number, S: Float64Array, so: number, count: number, O: Float64Array, oo: number): number {
  let curA = W, curO = wo;
  for (let i = 0; i < count; i++) {
    const p = so + 3 * i, out = curA === pingA ? pingB : pingA;
    const m = clipRaw(curA, curO, S[p], S[p + 1], S[p + 2], out, 0);
    if (m === 0) return 0;
    if (m > 0) { curA = out; curO = 0; }
  }
  if (curA === W) return -2;
  O[oo] = curA[0]; O[oo + 1] = curA[1]; O[oo + 2] = curA[2]; O[oo + 3] = curA[3];
  return 2;
}

export const flatKernel2: FlatFlowKernel = {
  dimension: 2,
  clip(W, wo, _n, P, po, sign, O, oo) {
    // flipLine negates n and d: exactly sign · each (no rounding).
    return sign < 0 ? clipRaw(W, wo, -P[po], -P[po + 1], -P[po + 2], O, oo) : clipRaw(W, wo, P[po], P[po + 1], P[po + 2], O, oo);
  },
  separators: (F, fo, _fn, T, to, _tn, S, so) => separators2(F, fo, T, to, S, so),
  clipToPlanes: (W, wo, _n, S, so, count, O, oo) => clipChain(W, wo, S, so, count, O, oo),
  clipToSeparators(F, fo, _fn, T, to, _tn, W, wo, _n, O, oo) {
    const count = separators2(F, fo, T, to, sepScratch, 0);
    return clipChain(W, wo, sepScratch, 0, count, O, oo);
  },
};
