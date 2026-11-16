/**
 * The 2D geometry kernel as seen by the shared compiler stages
 * (`shared/core/geometry.ts`): planes are lines, facets are segments, cells
 * are tagged convex polygons.
 */

import type { Dim, Geometry } from "../../shared/core";
import { wallTouchesRegion } from "./bsp/refine";
import {
  type ConvexPolygon, type Segment, type Vec2,
  ZERO, aabbFromPoints, aabbOverlaps, classifySegment, clipPolygon, clipSegmentFront, dot, expandAabb, flipLine,
  polygonFromAabb, sameOrientedLine, signedDistance,
} from "./math";
import { packPolygon, packSegment, unpackPolygon, unpackSegment } from "./pack";
import { clipToSeparators } from "./vis/antipenumbra";

export type Dim2 = Dim<Vec2, Segment, ConvexPolygon>;

export const geometry2: Geometry<Dim2> = {
  dimension: 2,
  zero: ZERO,
  dot,
  coords: (v) => [v.x, v.y],
  vecAt: (data, at) => ({ x: data[at], y: data[at + 1] }),
  signedDistance,
  flipPlane: flipLine,
  sameOrientedPlane: sameOrientedLine,
  axisPlane: (axis, d) => ({ n: { x: axis === 0 ? 1 : 0, y: axis === 1 ? 1 : 0 }, d }),
  boundsOf: aabbFromPoints,
  expandBounds: expandAabb,
  boundsOverlap: aabbOverlaps,
  facetPoints: (s) => [s.a, s.b],
  classifyFacet: classifySegment,
  clipFacet: clipSegmentFront,
  cellFromBounds: (box, tag) => polygonFromAabb(box, [tag, tag, tag, tag]),
  clipCell: clipPolygon,
  cellVertices: (cell) => cell.vertices,
  cellHasTag: (cell, tag) => cell.tags.includes(tag),
  retagCell: (cell, map) => ({ vertices: cell.vertices, tags: cell.tags.map(map) }),
  packFacet: packSegment,
  unpackFacet: unpackSegment,
  packCell: packPolygon,
  unpackCell: unpackPolygon,
  wallTouchesCell: wallTouchesRegion,
  clipToSeparators,
};
