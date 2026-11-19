/**
 * Exact batch scoring of parallel splitter candidates (BSP build hot spot).
 *
 * Scoring one candidate classifies every fragment: O(n) each, O(n·k) for k
 * candidates, quadratic near the root. Architectural levels have few normal
 * directions, so most candidates share a normal with many others. For one
 * normal `n`, a fragment's classification against any plane `(±n, d)` only
 * depends on the extremes of `x = n·p` over its vertices:
 *
 *   s_i = fl(x_i − t)        (t = d, or −d for the flipped normal; negation is exact)
 *   anyFront ⇔ fl(max x − t) >  eps,   anyBack ⇔ fl(min x − t) < −eps
 *
 * (rounding of `x − t` is monotone in `x`, so max/min commute with it). Sorting
 * the fragments' max and min values turns the front/back counts into binary
 * searches. Spanning = anyBack − ¬anyFront + on, where "on" fragments (both
 * flags false) are thin along `n` and found by a window scan. Results are
 * bit-identical to classifying each fragment with `classifyFacet`.
 */

import type { Dim, Geometry, Plane } from "../geometry";
import { PLANE_EPSILON } from "../math";
import type { BspBuildOptions, Fragment } from "./build";
import { balanceQuantum, splitterScore } from "./score";

/** Smallest group of parallel candidates worth a sweep (below it the per-candidate loop with early-out wins). */
export const SWEEP_MIN_GROUP = 4;

/**
 * Exact scores (see `scoreSplitters`) of the candidates sharing a normal with at least
 * {@link SWEEP_MIN_GROUP} − 1 others. `candidates`: plane indices into `planes`.
 * Returns plane index → score; candidates not in a large group are absent.
 */
export function sweepScores<D extends Dim>(g: Geometry<D>, frags: readonly Fragment<D>[], candidates: readonly number[], planes: readonly Plane<D>[], opts: BspBuildOptions): Map<number, number> {
  const scores = new Map<number, number>();
  const groups = groupByNormal(g, candidates, planes);
  if (groups.length === 0) return scores;
  const byPlane = new Map<number, number[]>();
  frags.forEach((f, i) => { const list = byPlane.get(f.plane); if (list) list.push(i); else byPlane.set(f.plane, [i]); });
  for (const group of groups) scoreGroup(g, frags, group, planes, opts, byPlane, scores);
  return scores;
}

/** Candidates sharing one normal direction: `normal` canonical, `flipped[k]` true if candidate k uses −normal. */
interface NormalGroup<V> {
  readonly normal: V;
  readonly members: number[];
  readonly flipped: boolean[];
}

/** Groups candidates by exactly equal (or exactly negated) normals; keeps groups of size ≥ SWEEP_MIN_GROUP. */
function groupByNormal<D extends Dim>(g: Geometry<D>, candidates: readonly number[], planes: readonly Plane<D>[]): NormalGroup<D["vec"]>[] {
  const groups = new Map<string, NormalGroup<D["vec"]>>();
  for (const c of candidates) {
    const n = planes[c].n;
    const xs = g.coords(n);
    const first = xs.find((x) => x !== 0) ?? 1;
    const flip = first < 0;
    // String(-0) === "0", so ±0 components share a key (they give the same signed distances).
    const key = (flip ? xs.map((x) => -x) : xs).join(",");
    let group = groups.get(key);
    if (!group) groups.set(key, group = { normal: flip ? g.flipPlane(planes[c]).n : n, members: [], flipped: [] });
    group.members.push(c);
    group.flipped.push(flip);
  }
  return [...groups.values()].filter((gr) => gr.members.length >= SWEEP_MIN_GROUP);
}

/** First index in sorted `xs` where `pred` holds (`pred` monotone false → true); `xs.length` if none. */
function firstTrue(xs: Float64Array, pred: (x: number) => boolean): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pred(xs[mid])) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/**
 * Scores every member of one normal group into `scores`.
 * `byPlane`: plane id → indices of fragments on it (excluded from their own candidate, counted for the bonus).
 */
function scoreGroup<D extends Dim>(
  g: Geometry<D>, frags: readonly Fragment<D>[], group: NormalGroup<D["vec"]>, planes: readonly Plane<D>[],
  opts: BspBuildOptions, byPlane: ReadonlyMap<number, readonly number[]>, scores: Map<number, number>,
): void {
  const eps = PLANE_EPSILON;
  const count = frags.length;
  const axis: Plane<D> = { n: group.normal, d: 0 };
  // lo[i] / hi[i]: min / max of x = n·p over fragment i's vertices (same arithmetic as signedDistance).
  const lo = new Float64Array(count), hi = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let mn = Infinity, mx = -Infinity;
    for (const p of g.facetPoints(frags[i].winding)) {
      const x = g.signedDistance(axis, p);
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    lo[i] = mn;
    hi[i] = mx;
  }
  const sortedLo = lo.slice().sort(), sortedHi = hi.slice().sort();
  // Thin fragments (extent ≤ 3 eps along n) are the only ones that can be "on" a plane of this group.
  const thin: number[] = [];
  for (let i = 0; i < count; i++) if (hi[i] - lo[i] <= 3 * eps) thin.push(i);
  thin.sort((a, b) => lo[a] - lo[b]);
  const thinLo = Float64Array.from(thin, (i) => lo[i]);
  const facing = opts.facingWeight ?? 0;
  const q = balanceQuantum(count);

  group.members.forEach((c, k) => {
    const flipped = group.flipped[k];
    const plane = planes[c];
    const t = flipped ? -plane.d : plane.d;
    const front = (x: number): boolean => x - t > eps; // anyFront from max x
    const back = (x: number): boolean => x - t < -eps; // anyBack from min x
    let anyFront = count - firstTrue(sortedHi, front);
    let anyBack = firstTrue(sortedLo, (x) => !back(x));
    let on = 0, onOpposite = 0;
    for (let j = firstTrue(thinLo, (x) => x >= t - 2 * eps); j < thin.length && thinLo[j] <= t + 2 * eps; j++) {
      const i = thin[j];
      if (front(hi[i]) || back(lo[i])) continue;
      on++;
      const f = frags[i];
      if (f.plane !== c && g.dot(planes[f.plane].n, plane.n) < 0) onOpposite++;
    }
    let splits = anyBack - (count - anyFront) + on;
    // Fragments on the candidate's own plane are consumed by the node: remove their contribution.
    const own = byPlane.get(c) ?? [];
    for (const i of own) {
      const af = front(hi[i]), ab = back(lo[i]);
      if (af) anyFront--;
      if (ab) anyBack--;
      if (af && ab) splits--;
    }
    const nFront = flipped ? anyBack : anyFront;
    const nBack = (flipped ? anyFront : anyBack) + onOpposite;
    scores.set(c, splitterScore(splits, nFront, nBack, facing ? own.length : 0, q, opts));
  });
}
