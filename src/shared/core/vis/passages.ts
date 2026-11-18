/**
 * Phase 2a: tightened "might see" (q3map2 passage vis, `CreatePassages`).
 *
 * Any sight line from portal p leaves leaf `p.to` through some first portal t, then hits every
 * later portal k inside the antipenumbra of (p, t). So
 *
 *   canSee(p, t) = { t } ∪ { k ∈ mightSee[p] ∩ mightSee[t] : clipToSeparators(p', t', k') ≠ null }
 *   mightSee'[p] = flood from p.to through ∪_t canSee(p, t)
 *
 * with p' = p behind t, t' = t in front of p, k' = k in front of p (flow steps 1–2, depth 1/2
 * with the whole source). This is the flow's depth-2 test with an unclipped source, so it only
 * drops portals no sight line reaches: mightSee' ⊆ mightSee, still conservative.
 */

import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import { BitSet } from "./bitset";

/**
 * Tightened mightSee rows. `mightSee`: base vis rows (`computeBaseVis`), one per portal.
 * Returns new rows, each a subset of its input row.
 */
export function computePassageVis<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[]): BitSet[] {
  const n = graph.portals.length;
  const out: BitSet[] = new Array(n);
  const visitedLeaf = new Uint8Array(graph.leafCount);
  for (let p = 0; p < n; p++) {
    out[p] = floodPortals(graph, graph.portals[p].to, passageCandidates(g, graph, mightSee, p), visitedLeaf);
  }
  return out;
}

/** ∪_t canSee(p, t) over the first portals t out of `p.to` (see module doc). Not yet flooded. */
function passageCandidates<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], p: number): BitSet {
  const { portals } = graph;
  const P = portals[p], mp = mightSee[p], n = portals.length;
  const cand = new BitSet(n);
  const mw = mp.words, cw = cand.words;
  for (const t of graph.portalsFrom[P.to]) {
    if (!mp.has(t)) continue;
    const T = portals[t];
    const src = g.clipFacet(P.winding, g.flipPlane(T.plane));
    if (!src) continue;
    const pass = g.clipFacet(T.winding, P.plane);
    if (!pass) continue;
    cand.set(t);
    const seps = g.separators(src, pass);
    const tw = mightSee[t].words;
    for (let w = 0; w < mw.length; w++) {
      // Candidates k of this word not already accepted through another t.
      let bits = mw[w] & tw[w] & ~cw[w];
      while (bits !== 0) {
        const low = bits & -bits;
        bits ^= low;
        const k = (w << 5) + (31 - Math.clz32(low));
        const kf = g.clipFacet(portals[k].winding, P.plane);
        if (kf && g.clipFacetToPlanes(kf, seps)) cw[w] |= low;
      }
    }
  }
  return cand;
}

/**
 * Portals reachable from `start` leaf through portals in `allowed` (Golodetz Listing 5).
 * `visitedLeaf`: scratch, `leafCount` zeros; left zeroed on return.
 */
export function floodPortals<D extends Dim>(graph: PortalGraph<D>, start: number, allowed: BitSet, visitedLeaf: Uint8Array): BitSet {
  const reached = new BitSet(graph.portals.length);
  const stack = [start];
  const touched = [start];
  visitedLeaf[start] = 1;
  while (stack.length) {
    const leaf = stack.pop()!;
    for (const pid of graph.portalsFrom[leaf]) {
      if (!allowed.has(pid) || reached.has(pid)) continue;
      reached.set(pid);
      const to = graph.portals[pid].to;
      if (!visitedLeaf[to]) {
        visitedLeaf[to] = 1;
        touched.push(to);
        stack.push(to);
      }
    }
  }
  for (const l of touched) visitedLeaf[l] = 0;
  return reached;
}
