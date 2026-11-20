/**
 * Phase 6b: the 3D flow primitives on flat arrays ({@link FlatFlowKernel}). Same arithmetic, in
 * the same order, as `clipWinding` + `sanitizeWinding` (math/winding.ts) and `forEachSeparator`
 * (vis/antipenumbra.ts), so results are bit-identical; checked in tests/shared/flatFlow.test.ts.
 */

import { type FlatFlowKernel, MIN_AREA, MIN_LENGTH_SQ, PLANE_EPSILON, SEPARATOR_SIN_EPSILON } from "../../../shared/core";

// Read once: under Vite's module runner (bench, tests) every import read is a getter chain through the barrels.
const MIN_AREA_ = MIN_AREA;
const MIN_LENGTH_SQ_ = MIN_LENGTH_SQ;
const PLANE_EPSILON_ = PLANE_EPSILON;
const SIN_EPS_SQ_ = SEPARATOR_SIN_EPSILON * SEPARATOR_SIN_EPSILON;

// Private scratch, grown on demand (the kernel is not re-entrant, which the flow never needs).
let dist = new Float64Array(64);
let tmp = new Float64Array(192);
let pingA = new Float64Array(192), pingB = new Float64Array(192);

/** Grows the scratch so an n-vertex clip chain of `planes` planes fits. */
function ensureScratch(n: number, planes: number): void {
  const need = 3 * (n + planes + 2);
  if (tmp.length < need) tmp = new Float64Array(2 * need);
  if (pingA.length < need) { pingA = new Float64Array(2 * need); pingB = new Float64Array(2 * need); }
  if (dist.length < n + planes + 2) dist = new Float64Array(2 * (n + planes + 2));
}

/**
 * `clipWinding(W, plane)` then `sanitizeWinding`, plane = (nx, ny, nz, pd) already signed.
 * @returns vertex count written at `O[oo ..]`, 0 if gone, −n if unchanged.
 */
function clipRaw(W: Float64Array, wo: number, n: number, nx: number, ny: number, nz: number, pd: number, O: Float64Array, oo: number): number {
  const eps = PLANE_EPSILON_, minLenSq = MIN_LENGTH_SQ_; // locals: imports are getters under Vite's runner
  // Grow only dist / tmp here: a chain holds references into the ping-pong buffers.
  if (dist.length < n + 1) dist = new Float64Array(2 * (n + 1));
  if (tmp.length < 3 * (n + 1)) tmp = new Float64Array(6 * (n + 1));
  const ds = dist, t3 = tmp;
  let anyFront = false, anyBack = false;
  for (let i = 0; i < n; i++) {
    const q = wo + 3 * i;
    const s = nx * W[q] + ny * W[q + 1] + nz * W[q + 2] - pd;
    ds[i] = s;
    if (s > eps) anyFront = true;
    else if (s < -eps) anyBack = true;
  }
  if (!anyFront) return 0;
  if (!anyBack) return -n;
  // Sutherland–Hodgman into `tmp`.
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const dc = ds[i], dn = ds[j], a = wo + 3 * i;
    if (dc >= -eps) { t3[3 * m] = W[a]; t3[3 * m + 1] = W[a + 1]; t3[3 * m + 2] = W[a + 2]; m++; }
    if ((dc > eps && dn < -eps) || (dc < -eps && dn > eps)) {
      const t = dc / (dc - dn), b = wo + 3 * j;
      const ax = W[a], ay = W[a + 1], az = W[a + 2];
      t3[3 * m] = ax + (W[b] - ax) * t; t3[3 * m + 1] = ay + (W[b + 1] - ay) * t; t3[3 * m + 2] = az + (W[b + 2] - az) * t;
      m++;
    }
  }
  // sanitizeWinding: drop near-duplicate consecutive vertices, then the area test (Newell normal).
  let k = 0;
  for (let i = 0; i < m; i++) {
    const i1 = i + 1 === m ? 0 : i + 1;
    const dx = t3[3 * i] - t3[3 * i1], dy = t3[3 * i + 1] - t3[3 * i1 + 1], dz = t3[3 * i + 2] - t3[3 * i1 + 2];
    if (dx * dx + dy * dy + dz * dz < minLenSq) continue;
    const o = oo + 3 * k;
    O[o] = t3[3 * i]; O[o + 1] = t3[3 * i + 1]; O[o + 2] = t3[3 * i + 2];
    k++;
  }
  if (k < 3) return 0;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < k; i++) {
    const a = oo + 3 * i, b = oo + 3 * (i + 1 === k ? 0 : i + 1);
    x += (O[a + 1] - O[b + 1]) * (O[a + 2] + O[b + 2]);
    y += (O[a + 2] - O[b + 2]) * (O[a] + O[b]);
    z += (O[a] - O[b]) * (O[a + 1] + O[b + 1]);
  }
  return 0.5 * Math.sqrt(x * x + y * y + z * z) < MIN_AREA_ ? 0 : k;
}

/**
 * State of a clip chain (`clipToPlanes` / `clipToSeparators`): the current facet is `(curA, curO, curN)`,
 * either the caller's input or one of the ping-pong buffers (offset 0).
 */
let curA: Float64Array = pingA, curO = 0, curN = 0;

/** Clips the chain's current facet by one plane; false once it vanished. */
function chainClip(nx: number, ny: number, nz: number, d: number): boolean {
  const out = curA === pingA ? pingB : pingA;
  const m = clipRaw(curA, curO, curN, nx, ny, nz, d, out, 0);
  if (m === 0) { curN = 0; return false; }
  if (m > 0) { curA = out; curO = 0; curN = m; }
  return true;
}

/** Ends a chain started on `(W, wo, n)`: copies a changed result to `O[oo ..]`; same return convention as `clipRaw`. */
function chainEnd(W: Float64Array, n: number, O: Float64Array, oo: number): number {
  if (curN === 0) return 0;
  if (curA === W) return -n;
  O.set(curA.subarray(0, 3 * curN), oo);
  return curN;
}

/**
 * `forEachSeparator` (antipenumbra.ts) over edges of `owner` × vertices of `other`. Each separator is
 * clipped into the chain (`clipping`) or appended at `S[so + 4·count ..]`. Returns false to stop.
 */
function separatorPass(OW: Float64Array, ow: number, on: number, OT: Float64Array, ot: number, otn: number, ownerIsFrom: boolean, clipping: boolean, S: Float64Array | null, so: number): boolean {
  const eps = PLANE_EPSILON_;
  for (let i = 0; i < on; i++) {
    const i1 = (i + 1) % on;
    const a = ow + 3 * i, b = ow + 3 * i1;
    const ax = OW[a], ay = OW[a + 1], az = OW[a + 2];
    const ex = OW[b] - ax, ey = OW[b + 1] - ay, ez = OW[b + 2] - az;
    const eLenSq = ex * ex + ey * ey + ez * ez;
    for (let v = 0; v < otn; v++) {
      const q0 = ot + 3 * v;
      const vx = OT[q0] - ax, vy = OT[q0 + 1] - ay, vz = OT[q0 + 2] - az;
      let nx = ey * vz - ez * vy, ny = ez * vx - ex * vz, nz = ex * vy - ey * vx;
      const lenSq = nx * nx + ny * ny + nz * nz;
      if (lenSq < SIN_EPS_SQ_ * eLenSq * (vx * vx + vy * vy + vz * vz) || lenSq === 0) continue; // v on the edge's line (scale-free)
      const len = Math.sqrt(lenSq);
      nx /= len; ny /= len; nz /= len;
      const d = nx * ax + ny * ay + nz * az;
      let ownerSide = 0;
      for (let k = 0; k < on; k++) {
        if (k === i || k === i1) continue;
        const q = ow + 3 * k;
        const s = nx * OW[q] + ny * OW[q + 1] + nz * OW[q + 2] - d;
        if (s > eps) { ownerSide = 1; break; }
        if (s < -eps) { ownerSide = -1; break; }
      }
      if (ownerSide === 0) continue;
      let ok = true, strict = false;
      for (let k = 0; k < otn; k++) {
        const q = ot + 3 * k;
        const s = (nx * OT[q] + ny * OT[q + 1] + nz * OT[q + 2] - d) * -ownerSide;
        if (s < -eps) { ok = false; break; }
        if (s > eps) strict = true;
      }
      if (!ok || !strict) continue;
      const flip = ownerIsFrom ? ownerSide > 0 : ownerSide < 0;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const pd = flip ? -d : d;
      if (clipping) { if (!chainClip(nx, ny, nz, pd)) return false; }
      else { const o = so + 4 * sepCount++; S![o] = nx; S![o + 1] = ny; S![o + 2] = nz; S![o + 3] = pd; }
    }
  }
  return true;
}
let sepCount = 0;

export const flatKernel3: FlatFlowKernel = {
  dimension: 3,
  clip(W, wo, n, P, po, sign, O, oo) {
    // flipPlane negates n and d: exactly sign · each (no rounding).
    return sign < 0 ? clipRaw(W, wo, n, -P[po], -P[po + 1], -P[po + 2], -P[po + 3], O, oo) : clipRaw(W, wo, n, P[po], P[po + 1], P[po + 2], P[po + 3], O, oo);
  },
  separators(F, fo, fn, T, to, tn, S, so) {
    sepCount = 0;
    separatorPass(F, fo, fn, T, to, tn, true, false, S, so) && separatorPass(T, to, tn, F, fo, fn, false, false, S, so);
    return sepCount;
  },
  clipToPlanes(W, wo, n, S, so, count, O, oo) {
    ensureScratch(n, count);
    curA = W; curO = wo; curN = n;
    for (let i = 0; i < count; i++) {
      const p = so + 4 * i;
      if (!chainClip(S[p], S[p + 1], S[p + 2], S[p + 3])) break;
    }
    return chainEnd(W, n, O, oo);
  },
  clipToSeparators(F, fo, fn, T, to, tn, W, wo, n, O, oo) {
    ensureScratch(n, 2 * fn * tn);
    curA = W; curO = wo; curN = n;
    separatorPass(F, fo, fn, T, to, tn, true, true, null, 0) && separatorPass(T, to, tn, F, fo, fn, false, true, null, 0);
    return chainEnd(W, n, O, oo);
  },
};
