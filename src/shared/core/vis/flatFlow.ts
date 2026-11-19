/**
 * Phase 6b: {@link flowFromSource} on flat arrays. Same walk, same steps, same counters and
 * bit-identical results (the kernel ops match the object ops exactly); only the storage differs:
 *
 * - portal windings and planes come from {@link FlatPortals} (built once per graph, cached);
 * - every clipped facet lives in one growing `Float64Array` arena used as a stack: a frame's
 *   generator loop resets the top to the frame's mark, so a step allocates nothing;
 * - separators cached per frame (phase 1b) live on a second stack the same way.
 *
 * A facet is `(array, offset, count)`. An arena that grows is replaced by a larger copy; facets
 * already in the old one stay readable (they are never written again), so offsets stay valid.
 */

import type { Dim, Geometry } from "../geometry";
import { type FlatPortals, type PortalGraph, flattenPortals } from "../portals";
import { BitSet } from "./bitset";
import type { PassageTable } from "./passages";
import type { SourceFlow } from "./portalFlow";

/** Local copies of `flatKernel.ts` bounds (imports are getters under Vite's module runner). */
const maxSeparators = (fn: number, tn: number): number => 2 * fn * tn;
const maxClipOut = (n: number, planes: number, k: number): number => (n + planes + 1) * k;

const flatCache = new WeakMap<object, FlatPortals>();

/** The graph's {@link FlatPortals} (built on first use, then cached per graph object). */
function flatPortalsOf<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): FlatPortals {
  let fp = flatCache.get(graph);
  if (!fp) flatCache.set(graph, (fp = flattenPortals(g, graph)));
  return fp;
}

/** Same contract and result as {@link flowFromSource} (whose parameters these are). */
export function flowFromSourceFlat<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], known: readonly (BitSet | undefined)[], sourceId: number, clipSource: boolean, budget: number, onChain: Uint8Array, rank: Int32Array | null, cacheSeparators: boolean, passages: PassageTable | null): SourceFlow {
  const K = geometry.flatFlow;
  const { clip, separators, clipToPlanes, clipToSeparators } = K;
  const fp = flatPortalsOf(geometry, graph);
  const k = fp.dimension, pk = k + 1;
  const { plane: PL, coords: XC, vertexStart: VS } = fp;
  const { portals, portalsFrom } = graph;
  const sourcePortal = portals[sourceId];
  const vis = new BitSet(portals.length);
  const sourcePo = sourceId * pk;
  const sourceRank = rank ? rank[sourceId] : 0;
  let steps = 0, maxChainDepth = 0, truncated = false, facetClips = 0, separatorClips = 0;
  const rows: BitSet[] = [];
  const rowAt = (depth: number): BitSet => rows[depth] ?? (rows[depth] = new BitSet(portals.length));
  const sourceMight = mightSee[sourceId];
  let done = false;

  // Facet stack (A, top) and separator stack (S, sTop), in floats.
  let A = new Float64Array(1024), top = 0;
  let S = new Float64Array(1024), sTop = 0;
  const ensureA = (need: number): void => {
    if (top + need <= A.length) return;
    const next = new Float64Array(Math.max(2 * A.length, top + need));
    next.set(A.subarray(0, top));
    A = next;
  };
  const ensureS = (need: number): void => {
    if (sTop + need <= S.length) return;
    const next = new Float64Array(Math.max(2 * S.length, sTop + need));
    next.set(S.subarray(0, sTop));
    S = next;
  };

  /** `source` = (SA, so, sn); `pass` = (PA, po, pn), pn = 0 at depth 1 (no pass yet). */
  const recurse = (leaf: number, SA: Float64Array, so: number, sn: number, PA: Float64Array, po: number, pn: number, passId: number, might: BitSet, depth: number): void => {
    if (depth > maxChainDepth) maxChainDepth = depth;
    const mark = top, sMark = sTop;
    let sepA: Float64Array | null = null, sepO = 0, sepN = 0; // this frame's cached separators
    const out = portalsFrom[leaf];
    const slot0 = passages ? passages.slot[passId] : 0;
    for (let j = 0; j < out.length; j++) {
      const gid = out[j];
      if (!might.has(gid)) continue;
      const gen = portals[gid];
      if (onChain[gen.to]) continue;

      const row = rank && rank[gid] >= sourceRank ? undefined : known[gid];
      const newMight = rowAt(depth + 1);
      const fresh = passages
        ? BitSet.and3Into(newMight, might, row ?? mightSee[gid], passages.words, (slot0 + j) * passages.wordsPerRow, vis)
        : BitSet.andInto(newMight, might, row ?? mightSee[gid], vis);
      if (vis.has(gid) && !fresh) continue;

      if (++steps > budget) {
        truncated = true;
        return;
      }
      top = mark; // drop the previous generator's facets

      // 1. Keep the part of the source behind G.
      facetClips++;
      ensureA((sn + 1) * k);
      let srcA = SA, srcO = so, srcN = sn;
      let m = clip(SA, so, sn, PL, gid * pk, -1, A, top);
      if (m === 0) continue;
      const srcSame = m < 0;
      if (m > 0) { srcA = A; srcO = top; srcN = m; top += m * k; }
      // 2. G in front of the original source portal.
      facetClips++;
      const gn0 = VS[gid + 1] - VS[gid];
      ensureA((gn0 + 1) * k);
      let gA = XC, gO = VS[gid] * k, gN = gn0;
      m = clip(XC, gO, gn0, PL, sourcePo, 1, A, top);
      if (m === 0) continue;
      if (m > 0) { gA = A; gO = top; gN = m; top += m * k; }

      if (pn > 0) {
        // 3. G clipped to the antipenumbra of (source, pass).
        separatorClips++;
        if (cacheSeparators && srcSame) {
          if (!sepA) {
            ensureS(maxSeparators(sn, pn) * pk);
            sepN = separators(SA, so, sn, PA, po, pn, S, sTop);
            sepA = S; sepO = sTop; sTop += sepN * pk;
          }
          ensureA(maxClipOut(gN, sepN, k));
          m = clipToPlanes(gA, gO, gN, sepA, sepO, sepN, A, top);
        } else {
          ensureA(maxClipOut(gN, maxSeparators(srcN, pn), k));
          m = clipToSeparators(srcA, srcO, srcN, PA, po, pn, gA, gO, gN, A, top);
        }
        if (m === 0) continue;
        if (m > 0) { gA = A; gO = top; gN = m; top += m * k; }
        // 4. Source clipped to the reverse antipenumbra of (G, pass).
        if (clipSource) {
          separatorClips++;
          ensureA(maxClipOut(srcN, maxSeparators(gN, pn), k));
          m = clipToSeparators(gA, gO, gN, PA, po, pn, srcA, srcO, srcN, A, top);
          if (m === 0) continue;
          if (m > 0) { srcA = A; srcO = top; srcN = m; top += m * k; }
        }
      }

      if (!vis.has(gid)) {
        vis.set(gid);
        if (!sourceMight.hasAnyNotIn(vis)) {
          done = true;
          return;
        }
      }
      onChain[gen.to] = 1;
      recurse(gen.to, srcA, srcO, srcN, gA, gO, gN, gid, newMight, depth + 1);
      onChain[gen.to] = 0;
      if (truncated || done) return;
    }
    top = mark;
    sTop = sMark;
  };

  onChain[sourcePortal.from] = 1;
  onChain[sourcePortal.to] = 1;
  recurse(sourcePortal.to, XC, VS[sourceId] * k, VS[sourceId + 1] - VS[sourceId], XC, 0, 0, sourceId, mightSee[sourceId], 1);
  onChain.fill(0);

  return { sourceId, vis: truncated ? mightSee[sourceId].clone() : vis, steps, maxChainDepth, truncated, facetClips, separatorClips };
}
