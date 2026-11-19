/**
 * Phase 6a: a portal graph's geometry as flat typed arrays (structure of arrays), for the hot vis
 * kernels. In V8 a number field of an object is a boxed `HeapNumber` (two dependent loads per read)
 * and every geometry primitive is a call through `Geometry`; here a coordinate is one load from
 * contiguous memory. Built once per graph; the object graph stays the API everywhere else.
 */

import type { Dim, Geometry, Vec } from "../geometry";
import type { PortalGraph } from "./graph";

/**
 * Flat portal geometry; `k` = `dimension` (2 or 3), `n` = `count`.
 * - `plane`: `(n, k + 1)` row-major, portal i's normal `n` then `d` (front = `n·p − d > 0`).
 * - `center`: `(n, k)` bounding-sphere centres; `radius`: `(n,)` (see `portalSpheres`, inflated).
 * - `vertexStart`: `(n + 1,)` portal i's vertices are `[vertexStart[i], vertexStart[i + 1])`.
 * - `coords`: `(V, k)` row-major vertex coordinates of every portal facet, in `facetPoints` order.
 */
export interface FlatPortals {
  readonly dimension: number;
  readonly count: number;
  readonly plane: Float64Array;
  readonly center: Float64Array;
  readonly radius: Float64Array;
  readonly vertexStart: Int32Array;
  readonly coords: Float64Array;
}

/**
 * Flattens `graph`'s portals. `center` / `radius`: the bounding spheres (`portalSpheres`), passed in
 * so the numbers are the very same ones the object code uses; omitted (the flow needs none): empty arrays.
 * @param g kernel of the graph; @param graph portals to flatten; @returns the flat store.
 */
export function flattenPortals<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, center: readonly Vec<D>[] | null = null, radius: Float64Array = new Float64Array(0)): FlatPortals {
  const n = graph.portals.length, k = g.dimension;
  const plane = new Float64Array(n * (k + 1));
  const centers = new Float64Array(center ? n * k : 0);
  const vertexStart = new Int32Array(n + 1);
  const pts = graph.portals.map((p) => g.facetPoints(p.winding));
  for (let i = 0; i < n; i++) vertexStart[i + 1] = vertexStart[i] + pts[i].length;
  const coords = new Float64Array(vertexStart[n] * k);
  for (let i = 0; i < n; i++) {
    const pl = graph.portals[i].plane;
    plane.set(g.coords(pl.n), i * (k + 1));
    plane[i * (k + 1) + k] = pl.d;
    if (center) centers.set(g.coords(center[i]), i * k);
    let at = vertexStart[i] * k;
    for (const p of pts[i]) { coords.set(g.coords(p), at); at += k; }
  }
  return { dimension: k, count: n, plane, center: centers, radius, vertexStart, coords };
}
