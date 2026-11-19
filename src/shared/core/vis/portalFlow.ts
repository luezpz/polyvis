/**
 * Portal flow: the precise (but still conservative) portal-to-portal
 * visibility stage, after Teller (1992), Quake's `vis` (RecursiveLeafFlow) and
 * Golodetz (2009).
 *
 * For every *source* portal S we walk outward through the portal graph,
 * depth-first. The walk state is
 *
 *   - `source`: the part of S that can still see along the current chain,
 *   - `pass`:   the part of the latest portal visible through the chain,
 *   - `might`:  portals still possibly visible (intersection of "might see"
 *               sets of every portal on the chain).
 *
 * At each leaf, each outgoing *generator* portal G is tested:
 *
 *   1. The source is clipped to the back of G (sight lines go forward).
 *   2. G is clipped to the front of S's plane.
 *   3. G is clipped by the antipenumbra of (source, pass): separators with
 *      `pass` in front. Whatever survives can be seen from the source through
 *      the whole chain.
 *   4. The source is clipped by the antipenumbra of (G, pass), the "reverse"
 *      antipenumbra, shrinking it to the part that can actually see G. This
 *      tightens all further steps.
 *
 * If G survives, it is marked visible from S and the walk recurses through it.
 * Shrinking `source` and `pass` along the chain is conservative: any real
 * sight line through the chain hits each clipped portal, so it is never
 * clipped away.
 */

import type { Dim, Facet, Geometry, Plane } from "../geometry";
import type { PortalGraph } from "../portals";
import { BitSet } from "./bitset";
import { flowFromSourceFlat } from "./flatFlow";
import type { PassageTable } from "./passages";

export interface PortalFlowOptions {
  /** Clip the source by the reverse antipenumbra (step 4). Tighter results, slightly more work. */
  readonly clipSource: boolean;
  /**
   * Safety valve: maximum number of generator tests across the whole run.
   * When exceeded, remaining source portals fall back to their base "might see"
   * set (still conservative). 0 disables the limit.
   */
  readonly maxSteps: number;
  /**
   * Phase 1b: build the separators of (source, pass) once per recursion frame and reuse them for
   * every generator whose step 1 leaves the source unchanged. Exact (same result); off only for tests.
   */
  readonly cacheSeparators: boolean;
  /**
   * Phase 2b: canSee rows (`computePassages`) ANDed into `might` at every step from `pass` to a
   * generator. Conservative, tighter pruning; null: off. The pipeline sets it for `baseVis: "passages"`.
   */
  readonly passages: PassageTable | null;
  /**
   * Rows whose sizes set the source order ({@link portalFlowOrder}); null: `mightSee`. With
   * passages the pipeline passes the *base* rows: the tighter rows reorder sources and cost
   * steps (and change the result); base order gives the plain flow's result with fewer steps.
   */
  readonly orderBy: readonly BitSet[] | null;
  /** Phase 6b: run the walk on flat arrays (`flatFlow.ts`). Exact (same result); false: object path, for tests. */
  readonly flat?: boolean;
}

export const DEFAULT_PORTAL_FLOW_OPTIONS: PortalFlowOptions = Object.freeze({
  clipSource: true,
  maxSteps: 20_000_000,
  cacheSeparators: true,
  passages: null,
  orderBy: null,
  flat: true,
});

export interface PortalFlowStats {
  /** Number of generator portals tested. */
  readonly steps: number;
  /** Deepest portal chain explored. */
  readonly maxChainDepth: number;
  /** True if {@link PortalFlowOptions.maxSteps} was hit. */
  readonly truncated: boolean;
  /** `clipFacet` calls (steps 1 and 2), for the bench. */
  readonly facetClips: number;
  /** `clipToSeparators` calls (steps 3 and 4), for the bench. */
  readonly separatorClips: number;
}

/** Stats of an empty run, to accumulate {@link SourceFlow} results into. */
export const EMPTY_FLOW_STATS: PortalFlowStats = Object.freeze({ steps: 0, maxChainDepth: 0, truncated: false, facetClips: 0, separatorClips: 0 });

/** Adds one source's counters to `acc` (truncation and depth combine by or / max). */
export function addSourceStats(acc: PortalFlowStats, r: SourceFlow): PortalFlowStats {
  return {
    steps: acc.steps + r.steps,
    maxChainDepth: Math.max(acc.maxChainDepth, r.maxChainDepth),
    truncated: acc.truncated || r.truncated,
    facetClips: acc.facetClips + r.facetClips,
    separatorClips: acc.separatorClips + r.separatorClips,
  };
}

export interface PortalFlowResult {
  /** `portalVis[i]` = portals potentially visible through portal i. */
  readonly portalVis: BitSet[];
  readonly stats: PortalFlowStats;
}

/** Flow result of one source portal. */
export interface SourceFlow {
  readonly sourceId: number;
  /** Portals visible through the source; its base "might see" set if `truncated`. */
  readonly vis: BitSet;
  readonly steps: number;
  readonly maxChainDepth: number;
  /** True if the step budget ran out during this source. */
  readonly truncated: boolean;
  readonly facetClips: number;
  readonly separatorClips: number;
}

/**
 * Source order: portals that might see the least first, so their final results
 * prune the searches of more complex portals (Quake's "sorted portals").
 * Returns portal ids.
 */
export function portalFlowOrder(mightSee: readonly BitSet[]): number[] {
  const counts = mightSee.map((m) => m.count());
  return [...mightSee.keys()].sort((a, b) => counts[a] - counts[b]);
}

/**
 * Runs the flow from one source portal.
 * `known[i]`: finished vis of portal i if available (tighter pruning), else undefined (uses `mightSee[i]`).
 * `budget`: maximum generator tests (`Infinity`: unlimited); when exceeded the source falls back to `mightSee`.
 * `onChain`: scratch, `graph.leafCount` zeros; left zeroed on return.
 * `rank`: position of each portal in the flow order, or null. When given, `known[j]` is only used if
 * `rank[j] < rank[sourceId]`, so the result is the single-threaded one even if `known` holds later rows.
 * `cacheSeparators`, `passages`, `flat`: see {@link PortalFlowOptions}.
 */
export function flowFromSource<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], known: readonly (BitSet | undefined)[], sourceId: number, clipSource: boolean, budget: number, onChain: Uint8Array, rank: Int32Array | null = null, cacheSeparators = true, passages: PassageTable | null = null, flat = true): SourceFlow {
  if (flat) return flowFromSourceFlat(geometry, graph, mightSee, known, sourceId, clipSource, budget, onChain, rank, cacheSeparators, passages);
  // Hot loop: bind the geometry operations once.
  const { clipFacet, flipPlane, clipToSeparators, separators, clipFacetToPlanes } = geometry;
  const { portals, portalsFrom } = graph;
  const sourcePortal = portals[sourceId];
  const vis = new BitSet(portals.length);
  const sourcePlane = sourcePortal.plane;
  const sourceRank = rank ? rank[sourceId] : 0;
  let steps = 0;
  let maxChainDepth = 0;
  let truncated = false;
  let facetClips = 0;
  let separatorClips = 0;
  // 1d: one `might` row per recursion depth, reused across generators (no per-step allocation).
  const rows: BitSet[] = [];
  const rowAt = (depth: number): BitSet => rows[depth] ?? (rows[depth] = new BitSet(portals.length));
  // 1e: once vis covers mightSee[source], no step can add anything: stop the whole source.
  const sourceMight = mightSee[sourceId];
  let done = false;

  // `passId`: portal whose winding `pass` is a part of (the source itself at depth 1); `leaf` is its `to`.
  const recurse = (leaf: number, source: Facet<D>, pass: Facet<D> | null, passId: number, might: BitSet, depth: number): void => {
    if (depth > maxChainDepth) maxChainDepth = depth;
    // Separators of this frame's (source, pass), built on first use; valid while step 1 keeps `source`.
    let frameSeps: Plane<D>[] | null = null;
    const out = portalsFrom[leaf];
    const slot0 = passages ? passages.slot[passId] : 0;
    for (let j = 0; j < out.length; j++) {
      const gid = out[j];
      if (!might.has(gid)) continue;
      const gen = portals[gid];
      if (onChain[gen.to]) continue; // a straight line cannot re-enter a convex leaf

      // Prune: if G is already known visible and nothing new could be found beyond it, skip.
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

      // 1. Sight lines leave the source forward through G: keep the part of the source behind G.
      facetClips++;
      let src = clipFacet(source, flipPlane(gen.plane));
      if (!src) continue;
      // 2. G must be in front of the original source portal.
      facetClips++;
      let g = clipFacet(gen.winding, sourcePlane);
      if (!g) continue;

      if (pass) {
        // 3. Clip G to the antipenumbra of (source, pass).
        separatorClips++;
        if (cacheSeparators && src === source) g = clipFacetToPlanes(g, frameSeps ??= separators(source, pass));
        else g = clipToSeparators(src, pass, g);
        if (!g) continue;
        // 4. Clip the source to the reverse antipenumbra of (G, pass).
        if (clipSource) {
          separatorClips++;
          src = clipToSeparators(g, pass, src);
          if (!src) continue;
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
      recurse(gen.to, src, g, gid, newMight, depth + 1);
      onChain[gen.to] = 0;
      if (truncated || done) return;
    }
  };

  onChain[sourcePortal.from] = 1;
  onChain[sourcePortal.to] = 1;
  recurse(sourcePortal.to, sourcePortal.winding, null, sourceId, mightSee[sourceId], 1);
  onChain.fill(0);

  // If we were cut short, fall back to the conservative estimate for this portal.
  return { sourceId, vis: truncated ? mightSee[sourceId].clone() : vis, steps, maxChainDepth, truncated, facetClips, separatorClips };
}

/** Single-threaded portal flow over all source portals, in {@link portalFlowOrder}. */
export function computePortalFlow<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], options: Partial<PortalFlowOptions> = {}): PortalFlowResult {
  const opts: PortalFlowOptions = { ...DEFAULT_PORTAL_FLOW_OPTIONS, ...options };
  const n = graph.portals.length;
  const portalVis: BitSet[] = new Array(n);
  const onChain = new Uint8Array(graph.leafCount);
  let stats = EMPTY_FLOW_STATS;

  for (const sourceId of portalFlowOrder(opts.orderBy ?? mightSee)) {
    if (stats.truncated) {
      portalVis[sourceId] = mightSee[sourceId].clone();
      continue;
    }
    const budget = opts.maxSteps > 0 ? opts.maxSteps - stats.steps : Infinity;
    const r = flowFromSource(geometry, graph, mightSee, portalVis, sourceId, opts.clipSource, budget, onChain, null, opts.cacheSeparators, opts.passages, opts.flat ?? true);
    portalVis[sourceId] = r.vis;
    stats = addSourceStats(stats, r);
  }

  return { portalVis, stats };
}
