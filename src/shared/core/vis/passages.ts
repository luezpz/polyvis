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
import { type PortalGraph, flattenPortals } from "../portals";
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
export function createPassageRows<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], slot: Int32Array, flat = true): (p0: number, p1: number) => Uint32Array {
  if (flat) return createPassageRowsFlat(g, graph, mightSee, slot);
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

/**
 * Phase 6a leftover: {@link createPassageRows} on {@link FlatPortals} and the flow's flat kernel
 * (`Geometry.flatFlow`). Same table bit for bit: the kernel ops equal the object ops, and the sphere
 * pre-test is exact either way (it only skips clips whose result it already knows).
 */
function createPassageRowsFlat<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], slot: Int32Array): (p0: number, p1: number) => Uint32Array {
  const { portals, portalsFrom } = graph;
  const n = portals.length, wordsPerRow = (n + 31) >>> 5;
  const { center, radius } = portalSpheres(g, graph);
  const fp = flattenPortals(g, graph, center, radius);
  const { clip, separators } = g.flatFlow;
  const k = fp.dimension, pk = k + 1, eps = PLANE_EPSILON;
  const { plane: PL, coords: XC, vertexStart: VS, center: C, radius: R } = fp;
  let maxN = 0;
  for (let i = 0; i < n; i++) maxN = Math.max(maxN, VS[i + 1] - VS[i]);
  const maxSeps = 2 * (maxN + 1) * (maxN + 1);
  // k clipped to the front of p's plane, per p: `kn[k]` = −1 unknown, 0 gone, else its vertex count
  // at `KA[ko[k] ..]` (or the portal itself at XC when `kSame[k]`).
  const kn = new Int32Array(n), ko = new Int32Array(n), kSame = new Uint8Array(n);
  let KA = new Float64Array(1024), kTop = 0;
  const srcB = new Float64Array((maxN + 1) * k), passB = new Float64Array((maxN + 1) * k);
  const S = new Float64Array(maxSeps * pk);
  // Ping-pong buffers of one separator chain (each clip adds at most one vertex).
  const ping = [new Float64Array((maxN + maxSeps + 2) * k), new Float64Array((maxN + maxSeps + 2) * k)];

  /** Signed distance of portal q's sphere centre from plane (P, po). */
  const centreDist = (P: Float64Array, po: number, q: number): number => {
    let s = -P[po + k];
    for (let c = 0; c < k; c++) s += P[po + c] * C[q * k + c];
    return s;
  };

  return (p0, p1) => {
    const words = new Uint32Array((slot[p1] - slot[p0]) * wordsPerRow);
    for (let p = p0; p < p1; p++) {
      const P = portals[p], mw = mightSee[p].words, out = portalsFrom[P.to], ppo = p * pk;
      kn.fill(-1);
      kTop = 0;
      for (let j = 0; j < out.length; j++) {
        const t = out[j];
        if (!mightSee[p].has(t)) continue;
        // src = p behind t, pass = t in front of p.
        let sA = XC, so = VS[p] * k, sn = VS[p + 1] - VS[p];
        let m = clip(XC, so, sn, PL, t * pk, -1, srcB, 0);
        if (m === 0) continue;
        if (m > 0) { sA = srcB; so = 0; sn = m; }
        let tA = XC, to = VS[t] * k, tn = VS[t + 1] - VS[t];
        m = clip(XC, to, tn, PL, ppo, 1, passB, 0);
        if (m === 0) continue;
        if (m > 0) { tA = passB; to = 0; tn = m; }
        const base = (slot[p] - slot[p0] + j) * wordsPerRow, tw = mightSee[t].words;
        words[base + (t >>> 5)] |= 1 << (t & 31);
        let nSeps = -1;
        for (let w = 0; w < wordsPerRow; w++) {
          for (let bits = mw[w] & tw[w]; bits !== 0; bits &= bits - 1) {
            const q = (w << 5) | (31 - Math.clz32(bits & -bits));
            const r = R[q];
            if (kn[q] < 0) {
              // k' = q clipped to the front of p's plane, sphere-tested first.
              const d = centreDist(PL, ppo, q), qn = VS[q + 1] - VS[q];
              if (d + r <= eps) kn[q] = 0;
              else if (d - r > eps) { kn[q] = qn; kSame[q] = 1; }
              else {
                if (kTop + (qn + 1) * k > KA.length) { const next = new Float64Array(2 * KA.length + (qn + 1) * k); next.set(KA.subarray(0, kTop)); KA = next; }
                const mm = clip(XC, VS[q] * k, qn, PL, ppo, 1, KA, kTop);
                if (mm < 0) { kn[q] = qn; kSame[q] = 1; }
                else { kn[q] = mm; kSame[q] = 0; ko[q] = kTop; kTop += mm * k; }
              }
            }
            let cn = kn[q];
            if (cn === 0) continue;
            let cA = kSame[q] ? XC : KA, co = kSame[q] ? VS[q] * k : ko[q], buf = 0;
            if (nSeps < 0) nSeps = separators(sA, so, sn, tA, to, tn, S, 0);
            for (let i = 0; i < nSeps && cn > 0; i++) {
              const d = centreDist(S, i * pk, q);
              if (d + r <= eps) { cn = 0; break; }
              if (d - r > eps) continue;
              const O = ping[buf];
              const mm = clip(cA, co, cn, S, i * pk, 1, O, 0);
              if (mm === 0) cn = 0;
              else if (mm > 0) { cA = O; co = 0; cn = mm; buf ^= 1; }
            }
            if (cn > 0) words[base + w] |= 1 << (q & 31);
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
