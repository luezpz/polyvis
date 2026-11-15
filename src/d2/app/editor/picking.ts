/** Hit-testing helpers for the editor. */

import { type Brush, type Level, type Vec2, type PortalGraph, convexContains, distance, distanceToSegment, midpoint, signedArea } from "../../core";

/** All brushes containing `p`, smallest first (the 2D analogue of 3D `brushesAlongRay`; used to cycle overlaps). */
export function brushesAt(level: Level, p: Vec2): Brush[] {
  return level.brushes
    .filter((b) => convexContains(b.vertices, p))
    .map((b) => ({ b, area: signedArea(b.vertices) }))
    .sort((x, y) => x.area - y.area)
    .map((x) => x.b);
}

/** The smallest brush containing `p` (small brushes inside big rooms stay clickable). */
export function brushAt(level: Level, p: Vec2): Brush | null {
  return brushesAt(level, p)[0] ?? null;
}

/** Index of the edge (vertices[i] → vertices[i+1]) of `brush` whose midpoint handle is within `radius` of `p`, or -1. */
export function edgeHandleAt(brush: Brush, p: Vec2, radius: number): number {
  const vs = brush.vertices;
  let best = -1;
  let bestDist = radius;
  vs.forEach((a, i) => {
    const d = distance(midpoint(a, vs[(i + 1) % vs.length]), p);
    if (d <= bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/** Index of the vertex of `brush` within `radius` of `p`, or -1. */
export function vertexAt(brush: Brush, p: Vec2, radius: number): number {
  let best = -1;
  let bestDist = radius;
  brush.vertices.forEach((v, i) => {
    const d = distance(v, p);
    if (d <= bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}

/** Closest portal (by segment distance) within `radius` of `p`, or null. Prefers the portal whose `from` side contains `p`. */
export function portalAt(graph: PortalGraph, p: Vec2, radius: number): number | null {
  let best: number | null = null;
  let bestDist = radius;
  for (const portal of graph.portals) {
    const d = distanceToSegment(portal.winding, p);
    // Twins have the same distance; pick the one we are "looking through" (p behind it).
    const behind = portal.plane.n.x * p.x + portal.plane.n.y * p.y - portal.plane.d <= 0;
    if (behind && d <= bestDist) {
      best = portal.id;
      bestDist = d;
    }
  }
  return best;
}
