/**
 * Flat portal graph for worker messages: one `Float64Array` clones as a memcpy, while the object
 * graph (a `Vec` object per winding vertex) costs ~10 ms per worker on a few thousand portals,
 * serialized on the sending thread.
 */

import type { Dim, Geometry } from "../geometry";
import type { Portal, PortalGraph } from "./graph";

/**
 * Layout: `leafCount, portalCount`, per portal `from, to, planeIndex, twin, n (dimension numbers),
 * d, facet (packFacet)`, then per leaf `count, ids...` (`portalsFrom`, order kept: passage slots
 * depend on it).
 */
export function packPortalGraph<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): Float64Array {
  const out: number[] = [graph.leafCount, graph.portals.length];
  for (const p of graph.portals) {
    out.push(p.from, p.to, p.planeIndex, p.twin, ...g.coords(p.plane.n), p.plane.d);
    g.packFacet(p.winding, out);
  }
  for (const ids of graph.portalsFrom) out.push(ids.length, ...ids);
  return Float64Array.from(out);
}

/** Inverse of {@link packPortalGraph}. */
export function unpackPortalGraph<D extends Dim>(g: Geometry<D>, data: ArrayLike<number>): PortalGraph<D> {
  const leafCount = data[0], n = data[1];
  const portals: Portal<D>[] = new Array(n);
  let at = 2;
  for (let id = 0; id < n; id++) {
    const from = data[at], to = data[at + 1], planeIndex = data[at + 2], twin = data[at + 3];
    at += 4;
    const plane = { n: g.vecAt(data, at), d: data[at + g.dimension] };
    const [winding, next] = g.unpackFacet(data, at + g.dimension + 1);
    portals[id] = { id, from, to, planeIndex, plane, winding, twin };
    at = next;
  }
  const portalsFrom: number[][] = new Array(leafCount);
  for (let leaf = 0; leaf < leafCount; leaf++) {
    const count = data[at++];
    portalsFrom[leaf] = Array.from({ length: count }, (_, i) => data[at + i]);
    at += count;
  }
  return { leafCount, portals, portalsFrom };
}
