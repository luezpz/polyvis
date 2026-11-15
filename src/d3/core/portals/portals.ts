/**
 * Portal discovery and the leaf/portal graph.
 *
 * A portal is the shared boundary between two *empty* convex leaves: a convex
 * polygon. Because every leaf region face is tagged with the BSP plane that
 * created it, two leaves can only touch across faces with the same plane tag,
 * and on that plane one leaf lies in front and the other behind. Their shared
 * part is the 2D convex intersection of the two faces on that plane (clip one
 * face by the edge planes of the other); no fuzzy coplanarity tests needed.
 *
 * (This is equivalent to the "push a huge portal polygon down the tree" method
 * of Quake's qbsp, and is the 3D version of the 2D interval overlap.)
 *
 * Every geometric opening yields two *directed* portals, one per direction.
 * A directed portal `p` leads from leaf `p.from` into leaf `p.to`; its plane's
 * normal points into `p.to` and its winding is CCW seen from `p.to`.
 *
 * The resulting graph has leaves as nodes and directed portals as edges
 * (types in `shared/core/portals/graph.ts`).
 */

import * as shared from "../../../shared/core";
import { type Dim3, geometry3 } from "../geometry";
import {
  type Aabb, type Winding,
  aabbOverlaps, dot, flipPlane, intersectCoplanarWindings, reverseWinding, windingAabb, PLANE_EPSILON,
} from "../math";
import type { BspTree } from "../bsp";

/** Directed portal: `plane.n` points into `to`; `winding` is CCW seen from `to`. */
export type Portal = shared.Portal<Dim3>;
export type PortalGraph = shared.PortalGraph<Dim3>;

interface LeafFace {
  readonly leaf: number;
  /** Face winding re-oriented to be CCW around the BSP plane's normal. */
  readonly winding: Winding;
  readonly box: Aabb;
}

/** Finds all portals between empty leaves of the tree. */
export function buildPortalGraph(tree: BspTree): PortalGraph {
  // Bucket faces of empty leaves by plane, split into the leaves in front of / behind the plane.
  const frontFaces = new Map<number, LeafFace[]>();
  const backFaces = new Map<number, LeafFace[]>();

  tree.leaves.forEach((leaf, leafIndex) => {
    if (leaf.contents !== "empty" || !leaf.region) return;
    for (const face of leaf.region.faces) {
      const planeIndex = face.tag;
      if (planeIndex < 0) continue; // bounding-box face
      const plane = tree.planes[planeIndex];
      // Face normals point out of the leaf. Outward = −plane normal ⇒ the leaf is in front of the plane.
      const inFront = dot(face.plane.n, plane.n) < 0;
      const winding = inFront ? reverseWinding(face.winding) : face.winding;
      const entry: LeafFace = { leaf: leafIndex, winding, box: windingAabb(winding) };
      const bucket = inFront ? frontFaces : backFaces;
      const list = bucket.get(planeIndex);
      if (list) list.push(entry);
      else bucket.set(planeIndex, [entry]);
    }
  });

  const portals: Portal[] = [];
  const portalsFrom: number[][] = tree.leaves.map(() => []);

  // Deterministic order: planes ascending.
  const planeIds = [...frontFaces.keys()].filter((p) => backFaces.has(p)).sort((a, b) => a - b);
  for (const planeIndex of planeIds) {
    const plane = tree.planes[planeIndex];
    for (const f of frontFaces.get(planeIndex)!) {
      for (const b of backFaces.get(planeIndex)!) {
        if (!aabbOverlaps(f.box, b.box, PLANE_EPSILON * 10)) continue;
        const shared = intersectCoplanarWindings(b.winding, f.winding, plane.n);
        if (!shared) continue;
        // back leaf → front leaf: normal = plane normal, winding CCW around it.
        const id = portals.length;
        const forward: Portal = { id, from: b.leaf, to: f.leaf, planeIndex, plane, winding: shared, twin: id + 1 };
        const backward: Portal = { id: id + 1, from: f.leaf, to: b.leaf, planeIndex, plane: flipPlane(plane), winding: reverseWinding(shared), twin: id };
        portals.push(forward, backward);
        portalsFrom[b.leaf].push(id);
        portalsFrom[f.leaf].push(id + 1);
      }
    }
  }

  return { leafCount: tree.leaves.length, portals, portalsFrom };
}

/** Connected components of empty leaves, as a leaf → component id map (-1 for solid/degenerate leaves). */
export const leafComponents = (tree: BspTree, graph: PortalGraph): Int32Array => shared.leafComponents(tree, graph);

/** Flood-fills the empty leaves reachable from the level bounds (see `shared/core/portals/leaks.ts`). */
export const detectLeaks = (tree: BspTree, graph: PortalGraph): shared.LeakReport => shared.detectLeaks(geometry3, tree, graph);

export type { LeakReport } from "../../../shared/core";
