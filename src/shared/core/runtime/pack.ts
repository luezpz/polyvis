/**
 * Flat runtime export (phase 4): what an engine needs to run `visibleLeaves` itself, as typed
 * arrays (no kernel object formats; read with plain indexing, upload or memcpy as-is).
 *
 * CSR adjacency: portals out of leaf l are `leafPortals[leafPortalStart[l] .. leafPortalStart[l+1])`.
 * Portal p: `portalTo[p]`, plane `portalPlanes[p*(dim+1) ..]` = (n..., d), normal into `to`;
 * winding vertices `vertices[(portalVertexStart[p] + k)*dim ..]`, k < count (2D: a, b; 3D: CCW
 * seen from `to`). `portalClosed[p]` = 1 for latent portals (doors, phase 4b), else 0.
 * PVS: leaf l's row is `pvsWords[pvsLeafRow[l]*pvsWordsPerRow ..]`, bit j (LSB-first per u32) = leaf j.
 */

import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import { BitSet } from "../vis/bitset";
import type { PvsTable } from "../vis/pvsTable";

export interface RuntimeData {
  readonly dimension: number;
  readonly leafCount: number;
  readonly leafPortalStart: Int32Array;
  readonly leafPortals: Int32Array;
  readonly portalFrom: Int32Array;
  readonly portalTo: Int32Array;
  readonly portalPlanes: Float64Array;
  readonly portalVertexStart: Int32Array;
  readonly vertices: Float64Array;
  readonly portalClosed: Uint8Array;
  readonly pvsLeafRow: Int32Array;
  readonly pvsWordsPerRow: number;
  readonly pvsWords: Uint32Array;
}

/** Packs graph + shared-row PVS; `closed` lists latent portals (default none). */
export function packRuntime<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, pvs: PvsTable, closed: Iterable<number> = []): RuntimeData {
  const dim = g.dimension, n = graph.portals.length;
  const leafPortalStart = new Int32Array(graph.leafCount + 1);
  graph.portalsFrom.forEach((ids, l) => (leafPortalStart[l + 1] = leafPortalStart[l] + ids.length));
  const leafPortals = Int32Array.from(graph.portalsFrom.flat());
  const portalPlanes = new Float64Array(n * (dim + 1));
  const portalVertexStart = new Int32Array(n + 1);
  const verts: number[] = [];
  graph.portals.forEach((p, i) => {
    portalPlanes.set([...g.coords(p.plane.n), p.plane.d], i * (dim + 1));
    const pts = g.facetPoints(p.winding);
    for (const v of pts) verts.push(...g.coords(v));
    portalVertexStart[i + 1] = portalVertexStart[i] + pts.length;
  });
  const portalClosed = new Uint8Array(n);
  for (const p of closed) portalClosed[p] = 1;
  return {
    dimension: dim, leafCount: graph.leafCount, leafPortalStart, leafPortals,
    portalFrom: Int32Array.from(graph.portals, (p) => p.from),
    portalTo: Int32Array.from(graph.portals, (p) => p.to),
    portalPlanes, portalVertexStart, vertices: Float64Array.from(verts), portalClosed,
    pvsLeafRow: Int32Array.from(pvs.leafRow),
    pvsWordsPerRow: pvs.rows[0]?.words.length ?? 0,
    pvsWords: BitSet.packRows(pvs.rows),
  };
}

/** The PVS row of `leaf` from packed data (a copy). */
export function runtimePvsRow(data: RuntimeData, leaf: number): BitSet {
  const w = data.pvsWordsPerRow, r = data.pvsLeafRow[leaf];
  return new BitSet(data.leafCount, data.pvsWords.slice(r * w, (r + 1) * w));
}
