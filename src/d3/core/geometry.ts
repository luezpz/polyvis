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
  polyhedronFromAabb, polyhedronVertices, sameOrientedPlane, signedDistance,
} from "./math";
import { clipToSeparators } from "./vis/antipenumbra";

export type Dim3 = Dim<Vec3, Winding, ConvexPolyhedron>;

export const geometry3: Geometry<Dim3> = {
  dimension: 3,
  zero: ZERO,
  dot,
  coords: (v) => [v.x, v.y, v.z],
  signedDistance,
  flipPlane,
  sameOrientedPlane,
  axisPlane: (axis, d) => ({ n: { x: axis === 0 ? 1 : 0, y: axis === 1 ? 1 : 0, z: axis === 2 ? 1 : 0 }, d }),
  boundsOf: aabbFromPoints,
  expandBounds: expandAabb,
  boundsOverlap: aabbOverlaps,
  facetPoints: (w) => w,
  classifyFacet: classifyWinding,
  clipFacet: clipWinding,
  cellFromBounds: polyhedronFromAabb,
  clipCell: clipPolyhedron,
  cellVertices: polyhedronVertices,
  cellHasTag: (cell, tag) => cell.faces.some((f) => f.tag === tag),
  wallTouchesCell: wallTouchesRegion,
  clipToSeparators,
};
