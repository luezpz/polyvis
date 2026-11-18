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

import type { Dim, Facet, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import { BitSet } from "./bitset";

export interface PortalFlowOptions {
  /** Clip the source by the reverse antipenumbra (step 4). Tighter results, slightly more work. */
  readonly clipSource: boolean;
  /**
   * Safety valve: maximum number of generator tests across the whole run.
   * When exceeded, remaining source portals fall back to their base "might see"
   * set (still conservative). 0 disables the limit.
   */
  readonly maxSteps: number;
}

export const DEFAULT_PORTAL_FLOW_OPTIONS: PortalFlowOptions = Object.freeze({
  clipSource: true,
  maxSteps: 20_000_000,
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
 */
export function flowFromSource<D extends Dim>(geometry: Geometry<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], known: readonly (BitSet | undefined)[], sourceId: number, clipSource: boolean, budget: number, onChain: Uint8Array, rank: Int32Array | null = null): SourceFlow {
  // Hot loop: bind the geometry operations once.
  const { clipFacet, flipPlane, clipToSeparators } = geometry;
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

  const recurse = (leaf: number, source: Facet<D>, pass: Facet<D> | null, might: BitSet, depth: number): void => {
    if (depth > maxChainDepth) maxChainDepth = depth;
    for (const gid of portalsFrom[leaf]) {
      if (!might.has(gid)) continue;
      const gen = portals[gid];
      if (onChain[gen.to]) continue; // a straight line cannot re-enter a convex leaf

      // Prune: if G is already known visible and nothing new could be found beyond it, skip.
      const row = rank && rank[gid] >= sourceRank ? undefined : known[gid];
      const newMight = might.and(row ?? mightSee[gid]);
      if (vis.has(gid) && !newMight.hasAnyNotIn(vis)) continue;

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
        g = clipToSeparators(src, pass, g);
        if (!g) continue;
        // 4. Clip the source to the reverse antipenumbra of (G, pass).
        if (clipSource) {
          separatorClips++;
          src = clipToSeparators(g, pass, src);
          if (!src) continue;
        }
      }

      vis.set(gid);
      onChain[gen.to] = 1;
      recurse(gen.to, src, g, newMight, depth + 1);
      onChain[gen.to] = 0;
      if (truncated) return;
    }
  };

  onChain[sourcePortal.from] = 1;
  onChain[sourcePortal.to] = 1;
  recurse(sourcePortal.to, sourcePortal.winding, null, mightSee[sourceId], 1);
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

  for (const sourceId of portalFlowOrder(mightSee)) {
    if (stats.truncated) {
      portalVis[sourceId] = mightSee[sourceId].clone();
      continue;
    }
    const budget = opts.maxSteps > 0 ? opts.maxSteps - stats.steps : Infinity;
    const r = flowFromSource(geometry, graph, mightSee, portalVis, sourceId, opts.clipSource, budget, onChain);
    portalVis[sourceId] = r.vis;
    stats = addSourceStats(stats, r);
  }

  return { portalVis, stats };
}
