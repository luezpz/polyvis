/**
 * Passage vis (q3map2 `CreatePassages` / `PassagePortalFlow`; phases 2a + 2b).
 *
 * A sight line that crosses portal p and then portal t (t leaves leaf `p.to`) hits every later
 * portal k inside the antipenumbra of (p, t). So for every such pair
 *
 *   canSee(p, t) = { t } ∪ { k ∈ mightSee[p] ∩ mightSee[t] : clipToSeparators(p', t', k') ≠ null }
 *
 * with p' = p behind t, t' = t in front of p, k' = k in front of p (empty if p' or t' vanish).
 * Only portals no sight line reaches are dropped, so both uses stay conservative:
 *
 * - 2a: mightSee'[p] = flood from p.to through ∪_t canSee(p, t)   ({@link passageMightSee})
 * - 2b: the flow, stepping from `pass` to generator `gen`, ANDs canSee(pass, gen) into `might`,
 *   so every depth is pruned by the antipenumbra of its last two portals, not just depth 1.
 */

import type { Dim, Facet, Geometry, Plane } from "../geometry";
import { PLANE_EPSILON } from "../math";
import type { PortalGraph } from "../portals";
import { portalSpheres } from "./baseVis";
import { BitSet } from "./bitset";

/**
 * canSee rows, flat (structured-clone friendly). Row of (p, `portalsFrom[p.to][j]`) is slot
 * `slot[p] + j`; its words are `words[s * wordsPerRow, (s + 1) * wordsPerRow)`, bits = portals.
 */
export interface PassageTable {
  readonly slot: Int32Array;
  readonly wordsPerRow: number;
  readonly words: Uint32Array;
}

/** Slot offsets of a graph's {@link PassageTable}: `slot[p]` = Σ out-degree of portals before p (length n + 1). */
export function passageSlots<D extends Dim>(graph: PortalGraph<D>): Int32Array {
  const { portals, portalsFrom } = graph, n = portals.length;
  const slot = new Int32Array(n + 1);
  for (let p = 0; p < n; p++) slot[p + 1] = slot[p] + portalsFrom[portals[p].to].length;
  return slot;
}

/** Builds the whole {@link PassageTable} on this thread from base vis rows (`computeBaseVis`). */
export function computePassages<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[]): PassageTable {
  const slot = passageSlots(graph), n = graph.portals.length, wordsPerRow = (n + 31) >>> 5;
  const words = createPassageRows(g, graph, mightSee, slot)(0, n);
  return { slot, wordsPerRow, words };
}

/**
 * A row builder for one graph (sphere and scratch setup done once): `rows(p0, p1)` returns the
 * canSee rows of portals `[p0, p1)`, i.e. table slots `[slot[p0], slot[p1])` (fresh array, words
 * relative to `slot[p0]`). Ranges are independent, so workers can build them in parallel.
 */
export function createPassageRows<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], slot: Int32Array): (p0: number, p1: number) => Uint32Array {
  const { portals, portalsFrom } = graph;
  const n = portals.length, wordsPerRow = (n + 31) >>> 5;
  const { center, radius } = portalSpheres(g, graph);
  // k clipped to the front of p's plane, per p (k' is the same for every t of p).
  const clipped: (Facet<D> | null | undefined)[] = new Array(n);
  /** `f` (a part of portal k) clipped to the front of `plane`, sphere-tested first (exact, as in base vis). */
  const clipK = (f: Facet<D>, k: number, plane: Plane<D>): Facet<D> | null => {
    const d = g.signedDistance(plane, center[k]), r = radius[k];
    if (d + r <= PLANE_EPSILON) return null; // every vertex within ε of or behind the plane: clipped away
    if (d - r > PLANE_EPSILON) return f; // every vertex strictly in front: unchanged
    return g.clipFacet(f, plane);
  };

  return (p0, p1) => {
    const words = new Uint32Array((slot[p1] - slot[p0]) * wordsPerRow);
    for (let p = p0; p < p1; p++) {
      const P = portals[p], mw = mightSee[p].words, out = portalsFrom[P.to];
      clipped.fill(undefined);
      for (let j = 0; j < out.length; j++) {
        const t = out[j];
        if (!mightSee[p].has(t)) continue;
        const T = portals[t];
        const src = g.clipFacet(P.winding, g.flipPlane(T.plane));
        if (!src) continue;
        const pass = g.clipFacet(T.winding, P.plane);
        if (!pass) continue;
        const base = (slot[p] - slot[p0] + j) * wordsPerRow, tw = mightSee[t].words;
        words[base + (t >>> 5)] |= 1 << (t & 31);
        let seps: Plane<D>[] | null = null;
        for (let w = 0; w < wordsPerRow; w++) {
          for (let bits = mw[w] & tw[w]; bits !== 0; bits &= bits - 1) {
            const k = (w << 5) | (31 - Math.clz32(bits & -bits));
            let kf = clipped[k];
            if (kf === undefined) kf = clipped[k] = clipK(portals[k].winding, k, P.plane);
            if (!kf) continue;
            seps ??= g.separators(src, pass);
            for (let i = 0; i < seps.length && kf; i++) kf = clipK(kf, k, seps[i]);
            if (kf) words[base + w] |= 1 << (k & 31);
          }
        }
      }
    }
    return words;
  };
}

/** Phase 2a: tightened mightSee rows (each ⊆ its base row) from a {@link PassageTable}. */
export function passageMightSee<D extends Dim>(graph: PortalGraph<D>, table: PassageTable): BitSet[] {
  const n = graph.portals.length, { slot, wordsPerRow, words } = table;
  const visitedLeaf = new Uint8Array(graph.leafCount);
  const out: BitSet[] = new Array(n);
  for (let p = 0; p < n; p++) {
    const union = new BitSet(n), uw = union.words;
    for (let s = slot[p]; s < slot[p + 1]; s++) {
      const base = s * wordsPerRow;
      for (let w = 0; w < wordsPerRow; w++) uw[w] |= words[base + w];
    }
    out[p] = floodPortals(graph, graph.portals[p].to, union, visitedLeaf);
  }
  return out;
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
