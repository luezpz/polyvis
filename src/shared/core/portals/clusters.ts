/**
 * Vis clusters (optimization plan phase 3e): empty leaves merged into fewer, larger units so base
 * vis, passages and portal flow run on a smaller graph (q3map2 `vis -merge`, `TryMergeLeaves`).
 *
 * Merge rule (convexity): two clusters A and B joined by a portal merge only if no boundary piece
 * of B lies strictly outside a boundary plane of A, and vice versa. Boundary pieces are outgoing
 * portals (not those between A and B; plane faces out) and wall surfaces (plane flipped to face
 * out), so the merged cluster is a convex cell again. Two things need that:
 * - Correctness: a sight line leaving the cluster through portal q is in front of q's plane from
 *   then on and can never cross another of its portals back in, which keeps the flow's "a straight
 *   line cannot re-enter a leaf" rule (`onChain`). Portals alone would already guarantee this.
 * - Precision: with portals alone, a winding corridor with no side openings collapses into one
 *   cluster that sees everything. Walls stop merges around corners.
 *
 * Not exact: every leaf of a cluster gets the cluster's PVS (what any of its leaves might see).
 * Refinement splits exist to tighten rows, and merging across them undoes that. Bounding-box faces
 * (leaking levels only) are not boundary pieces.
 */

import { type BspTree, type ChildRef, isLeafRef, refToLeaf } from "../bsp";
import type { Dim, Facet, Geometry, Plane } from "../geometry";
import { Side } from "../math";
import type { Portal, PortalGraph } from "./graph";

export interface ClusterOptions {
  /** Clusters never grow beyond this many leaves (0: unlimited). */
  readonly maxLeaves: number;
  /**
   * Also merge across refinement splits (corner / cell-size splits, `bsp/refine.ts`). Those splits
   * exist to tighten rows, so merging across them costs the most precision. Default false: merge
   * only across wall-plane splits, which are artifacts of where a wall plane cut empty space.
   */
  readonly acrossRefinement: boolean;
}

export const DEFAULT_CLUSTER_OPTIONS: ClusterOptions = Object.freeze({ maxLeaves: 0, acrossRefinement: false });

export interface LeafClusters<D extends Dim> {
  /** `leafCluster[leaf]` = cluster id in `[0, count)`; every leaf (solid ones too) has one. */
  readonly leafCluster: Int32Array;
  readonly count: number;
  /**
   * Graph over clusters: `leafCount` = `count`, portals = leaf portals between different clusters
   * (renumbered, `from`/`to` = cluster ids, windings and planes unchanged).
   */
  readonly graph: PortalGraph<D>;
  /** `leafPortal[c]` = id in the leaf graph of cluster-graph portal `c`. */
  readonly leafPortal: Int32Array;
}

/** A boundary piece of a cluster: `plane` faces out of the cluster. */
export interface BoundaryPiece<D extends Dim> {
  readonly plane: Plane<D>;
  readonly winding: Facet<D>;
}

/** True if no piece of `bs` has a point strictly in front of a plane of `as`, and vice versa. */
function convexUnion<D extends Dim>(g: Geometry<D>, as: readonly BoundaryPiece<D>[], bs: readonly BoundaryPiece<D>[]): boolean {
  const outside = (h: BoundaryPiece<D>, f: BoundaryPiece<D>) => {
    const s = g.classifyFacet(h.plane, f.winding);
    return s === Side.Front || s === Side.Spanning;
  };
  for (const a of as) for (const b of bs) if (outside(a, b) || outside(b, a)) return false;
  return true;
}

/**
 * Greedy merge over the portals of `graph` (the leaf graph) in id order (deterministic).
 * `walls[leaf]`: wall pieces bounding each leaf, planes facing out of the leaf.
 * Returns the clusters and the cluster graph.
 */
export function buildLeafClusters<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, graph: PortalGraph<D>, walls: readonly (readonly BoundaryPiece<D>[])[], options: Partial<ClusterOptions> = {}): LeafClusters<D> {
  const { maxLeaves, acrossRefinement } = { ...DEFAULT_CLUSTER_OPTIONS, ...options };
  const refine = acrossRefinement ? null : refinementPortals(tree, graph);
  const { portals, leafCount } = graph;
  const parent = Int32Array.from({ length: leafCount }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  const size = new Int32Array(leafCount).fill(1);
  // Outgoing portals of each root; entries leading inside the cluster are dropped lazily.
  const out: number[][] = graph.portalsFrom.map((ps) => [...ps]);
  const wallsOf: BoundaryPiece<D>[][] = walls.map((w) => [...w]);

  for (const p of portals) {
    const a = find(p.from), b = find(p.to);
    if (a === b || (maxLeaves > 0 && size[a] + size[b] > maxLeaves) || refine?.[p.id]) continue;
    const ao = out[a].filter((q) => { const t = find(portals[q].to); return t !== a && t !== b; });
    const bo = out[b].filter((q) => { const t = find(portals[q].to); return t !== a && t !== b; });
    const pieces = (ps: readonly number[], ws: readonly BoundaryPiece<D>[]) => [...ws, ...ps.map((q) => portals[q])];
    if (!convexUnion(g, pieces(ao, wallsOf[a]), pieces(bo, wallsOf[b]))) {
      out[a] = out[a].filter((q) => find(portals[q].to) !== a);
      out[b] = out[b].filter((q) => find(portals[q].to) !== b);
      continue;
    }
    parent[b] = a;
    size[a] += size[b];
    out[a] = ao.concat(bo);
    out[b] = [];
    wallsOf[a] = wallsOf[a].concat(wallsOf[b]);
    wallsOf[b] = [];
  }

  // Compact ids in leaf order, then the cluster graph with external portals only.
  const leafCluster = new Int32Array(leafCount);
  const idOfRoot = new Int32Array(leafCount).fill(-1);
  let count = 0;
  for (let l = 0; l < leafCount; l++) {
    const r = find(l);
    if (idOfRoot[r] < 0) idOfRoot[r] = count++;
    leafCluster[l] = idOfRoot[r];
  }
  const newId = new Int32Array(portals.length).fill(-1);
  const kept: number[] = [];
  for (const p of portals) if (leafCluster[p.from] !== leafCluster[p.to]) { newId[p.id] = kept.length; kept.push(p.id); }
  const portalsFrom: number[][] = Array.from({ length: count }, () => []);
  const clusterPortals: Portal<D>[] = kept.map((old, id) => {
    const p = portals[old];
    const from = leafCluster[p.from];
    portalsFrom[from].push(id);
    return { ...p, id, from, to: leafCluster[p.to], twin: newId[p.twin] };
  });
  return { leafCluster, count, graph: { leafCount: count, portals: clusterPortals, portalsFrom }, leafPortal: Int32Array.from(kept) };
}

/**
 * `mask[portal]` = 1 if the portal lies on a refinement split. A portal lies on the plane of the
 * lowest common ancestor of its two leaves; refinement nodes are exactly the nodes whose subtree
 * holds only empty leaves (behind a wall split there is always solid space).
 */
export function refinementPortals<D extends Dim>(tree: BspTree<D>, graph: PortalGraph<D>): Uint8Array {
  const nodeCount = tree.nodes.length;
  // Parent of each node (index) and leaf (nodeCount + leaf), depth of each node; allEmpty per node.
  const parent = new Int32Array(nodeCount + tree.leaves.length).fill(-1);
  const depth = new Int32Array(nodeCount);
  const allEmpty = new Uint8Array(nodeCount);
  const slot = (r: ChildRef) => (isLeafRef(r) ? nodeCount + refToLeaf(r) : r);
  const visit = (r: ChildRef, d: number): boolean => {
    if (isLeafRef(r)) return tree.leaves[refToLeaf(r)].contents === "empty";
    const n = tree.nodes[r];
    depth[r] = d;
    parent[slot(n.front)] = r;
    parent[slot(n.back)] = r;
    const f = visit(n.front, d + 1), b = visit(n.back, d + 1);
    allEmpty[r] = f && b ? 1 : 0;
    return f && b;
  };
  if (!isLeafRef(tree.root)) visit(tree.root, 0);
  const mask = new Uint8Array(graph.portals.length);
  for (const p of graph.portals) {
    let a = parent[nodeCount + p.from], b = parent[nodeCount + p.to];
    while (a !== b) if (depth[a] >= depth[b]) a = parent[a]; else b = parent[b];
    mask[p.id] = a >= 0 ? allEmpty[a] : 0;
  }
  return mask;
}
