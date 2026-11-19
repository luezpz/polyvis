/**
 * Phase 6b: the flow's facet primitives on flat arrays (see `portals/flat.ts` for why flat).
 *
 * A facet is `(W, wo, n)`: `n` vertices at `W[wo ..]`, `k` = dimension coordinates each (2D: always a
 * segment, n = 2). A plane is `(P, po)`: `k` normal coordinates then `d` (front = `n·p − d > 0`).
 * Results are written to `(O, oo)` and returned as a vertex count with one convention everywhere:
 * `m > 0`: m vertices written; `0`: nothing left; `−n`: the input is the result, unchanged (nothing
 * written: lets the flow keep `src === source`, as the object code does).
 * Every function does the arithmetic of its object counterpart in the same order, so results are
 * bit-identical. Outputs must not overlap inputs. Kernels keep private scratch: not re-entrant.
 */
export interface FlatFlowKernel {
  /** Coordinates per vertex (2 or 3). */
  readonly dimension: number;
  /** `clipFacet(W, sign·plane)` (`sign` −1: the flipped plane, exactly `flipPlane`). Needs `(n + 1)·k` floats at `oo`. */
  clip(W: Float64Array, wo: number, n: number, P: Float64Array, po: number, sign: number, O: Float64Array, oo: number): number;
  /** `separators(from, to)` written as planes at `S[so ..]`; returns their count. Needs {@link maxSeparators}`·(k + 1)` floats. */
  separators(F: Float64Array, fo: number, fn: number, T: Float64Array, to: number, tn: number, S: Float64Array, so: number): number;
  /** `clipFacetToPlanes(W, count planes at S[so ..])`. Needs {@link maxClipOut} floats at `oo`. */
  clipToPlanes(W: Float64Array, wo: number, n: number, S: Float64Array, so: number, count: number, O: Float64Array, oo: number): number;
  /** `clipToSeparators(from, to, W)`. Needs {@link maxClipOut} floats at `oo`. */
  clipToSeparators(F: Float64Array, fo: number, fn: number, T: Float64Array, to: number, tn: number, W: Float64Array, wo: number, n: number, O: Float64Array, oo: number): number;
}

/** Upper bound on the separators of an `fn`-gon and a `tn`-gon (edges × vertices, both ways). */
export const maxSeparators = (fn: number, tn: number): number => 2 * fn * tn;

/**
 * Floats a multi-plane clip of an n-gon by `planes` planes may write: each convex clip adds at most
 * one vertex. `k`: dimension.
 */
export const maxClipOut = (n: number, planes: number, k: number): number => (n + planes + 1) * k;
