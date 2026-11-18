/**
 * Base vis: a cheap, conservative first estimate of portal-to-portal
 * visibility ("might see"), used to prune the expensive flow stage.
 *
 * Two rules (Golodetz 2009, Listing 4; Quake `vis` "BasePortalVis"):
 *
 * 1. Portal `i` can only see portal `j` if `j` has some part strictly *in
 *    front* of `i`, i.e. on the destination side of `i`.
 * 2. Portal `j` must lead *away* from `i`: `i` must have some part strictly
 *    *behind* `j`. (A portal pointing back towards `i` is seen from its back.)
 *
 * Then a flood fill from `i` through the graph, only along portals passing
 * both rules, removes portals that pass the rules but are not reachable
 * (Golodetz Listing 5).
 */

import type { Dim, Geometry, Vec } from "../geometry";
import { PLANE_EPSILON, Side } from "../math";
import type { PortalGraph } from "../portals";
import { BitSet } from "./bitset";
import { floodPortals } from "./passages";

/**
 * Bounding spheres of portal windings (Quake 2 `portal->origin/radius`), flat:
 * `center[i]` = vertex mean of portal i, `radius[i]` = max vertex distance from it,
 * slightly inflated so float error never turns a sphere verdict wrong.
 */
export interface PortalSpheres<D extends Dim> {
  readonly center: readonly Vec<D>[];
  readonly radius: Float64Array;
}

/** Computes {@link PortalSpheres} for every portal of `graph`. */
export function portalSpheres<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): PortalSpheres<D> {
  const n = graph.portals.length, dim = g.dimension;
  const center: Vec<D>[] = new Array(n);
  const radius = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pts = g.facetPoints(graph.portals[i].winding).map((p) => g.coords(p));
    const c = new Array<number>(dim).fill(0);
    for (const p of pts) for (let k = 0; k < dim; k++) c[k] += p[k] / pts.length;
    let r2 = 0;
    for (const p of pts) {
      let d2 = 0;
      for (let k = 0; k < dim; k++) d2 += (p[k] - c[k]) ** 2;
      if (d2 > r2) r2 = d2;
    }
    center[i] = g.vecAt(c, 0);
    radius[i] = Math.sqrt(r2) * (1 + 1e-9) + 1e-9;
  }
  return { center, radius };
}

/**
 * Rule 1 + rule 2 for an ordered portal pair.
 * `spheres` (optional, phase 1a): decides most pairs from one plane distance per rule, falling
 * back to `classifyFacet` only when a sphere straddles the `±PLANE_EPSILON` band. Same verdicts:
 * rule 1 passes iff some vertex of j is at distance > ε from i's plane, so `d(c) + r ≤ ε`
 * rejects and `d(c) − r > ε` accepts; rule 2 mirrors it with −ε.
 */
export function portalMightSeePortal<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, i: number, j: number, spheres: PortalSpheres<D> | null = null): boolean {
  if (i === j) return false;
  const pi = graph.portals[i], pj = graph.portals[j];
  if (spheres) {
    const dj = g.signedDistance(pi.plane, spheres.center[j]), rj = spheres.radius[j];
    if (dj + rj <= PLANE_EPSILON) return false;
    if (dj - rj <= PLANE_EPSILON) {
      const jVsI = g.classifyFacet(pi.plane, pj.winding);
      if (jVsI !== Side.Front && jVsI !== Side.Spanning) return false;
    }
    const di = g.signedDistance(pj.plane, spheres.center[i]), ri = spheres.radius[i];
    if (di - ri >= -PLANE_EPSILON) return false;
    if (di + ri < -PLANE_EPSILON) return true;
  } else {
    const jVsI = g.classifyFacet(pi.plane, pj.winding);
    if (jVsI !== Side.Front && jVsI !== Side.Spanning) return false;
  }
  const iVsJ = g.classifyFacet(pj.plane, pi.winding);
  return iVsJ === Side.Back || iVsJ === Side.Spanning;
}

/**
 * Computes the "might see" set of every portal.
 * `useSpheres`: bounding-sphere pre-test (phase 1a); same result, fewer `classifyFacet` calls.
 */
export function computeBaseVis<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, useSpheres = true): BitSet[] {
  const n = graph.portals.length;
  const spheres = useSpheres ? portalSpheres(g, graph) : null;
  const result: BitSet[] = [];
  const visitedLeaf = new Uint8Array(graph.leafCount);
  for (let i = 0; i < n; i++) {
    const candidate = new BitSet(n);
    for (let j = 0; j < n; j++) if (portalMightSeePortal(g, graph, i, j, spheres)) candidate.set(j);

    // Flood through candidate portals starting from the leaf portal i leads into.
    const reached = floodPortals(graph, graph.portals[i].to, candidate, visitedLeaf);
    result.push(reached);
  }
  return result;
}
