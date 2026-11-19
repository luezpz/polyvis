/**
 * The 3D geometry kernel as seen by the shared compiler stages
 * (`shared/core/geometry.ts`): planes are planes, facets are windings, cells
 * are tagged convex polyhedra.
 */

import type { Dim, Geometry } from "../../shared/core";
import { wallTouchesRegion } from "./bsp/refine";
import {
  type ConvexPolyhedron, type Vec3, type Winding,
  ZERO, aabbFromPoints, aabbOverlaps, classifyWinding, clipPolyhedron, clipWinding, dot, expandAabb, flipPlane,
  polyhedronFromAabb, polyhedronVertices, sameOrientedPlane, signedDistance, windingArea,
} from "./math";
import { packPolyhedron, packWinding, unpackPolyhedron, unpackWinding } from "./pack";
import { portalFrustum3 } from "./runtime/portalFrustum";
import { flatKernel3 } from "./vis/flatKernel";
import { buildSeparators, clipToPlanes, clipToSeparators } from "./vis/antipenumbra";

export type Dim3 = Dim<Vec3, Winding, ConvexPolyhedron>;

export const geometry3: Geometry<Dim3> = {
  dimension: 3,
  zero: ZERO,
  dot,
  coords: (v) => [v.x, v.y, v.z],
  vecAt: (data, at) => ({ x: data[at], y: data[at + 1], z: data[at + 2] }),
  signedDistance,
  flipPlane,
  sameOrientedPlane,
  axisPlane: (axis, d) => ({ n: { x: axis === 0 ? 1 : 0, y: axis === 1 ? 1 : 0, z: axis === 2 ? 1 : 0 }, d }),
  boundsOf: aabbFromPoints,
  expandBounds: expandAabb,
  boundsOverlap: aabbOverlaps,
  facetPoints: (w) => w,
  facetMeasure: windingArea,
  classifyFacet: classifyWinding,
  clipFacet: clipWinding,
  cellFromBounds: polyhedronFromAabb,
  clipCell: clipPolyhedron,
  cellVertices: polyhedronVertices,
  cellHasTag: (cell, tag) => cell.faces.some((f) => f.tag === tag),
  retagCell: (cell, map) => ({ faces: cell.faces.map((f) => ({ ...f, tag: map(f.tag) })) }),
  packFacet: packWinding,
  unpackFacet: unpackWinding,
  packCell: packPolyhedron,
  unpackCell: unpackPolyhedron,
  wallTouchesCell: wallTouchesRegion,
  clipToSeparators,
  separators: (from, to) => buildSeparators(from, to),
  clipFacetToPlanes: clipToPlanes,
  portalFrustum: portalFrustum3,
  flatFlow: flatKernel3,
};
