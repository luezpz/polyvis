/**
 * Door → portals (phase 4b), on a tree already split by `splitLeavesByDoors`: a door's leaves are
 * the empty leaves whose centroid lies inside one of its volumes; its portals are those crossing
 * the boundary of that leaf set. Sealing is checked by a flood over the portal graph.
 */

import type { BspTree } from "../bsp";
import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import { type DoorInfo, type DoorVolume, cellCentroid, insideVolume } from "./types";

/** One {@link DoorInfo} per distinct door name, in first-appearance order. */
export function findDoors<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, graph: PortalGraph<D>, doors: readonly DoorVolume<D>[]): DoorInfo[] {
  const names = [...new Set(doors.map((d) => d.name))];
  const centroids = tree.leaves.map((l) => (l.contents === "empty" && l.region ? cellCentroid(g, l.region) : null));
  return names.map((name) => {
    const volumes = doors.filter((d) => d.name === name);
    const inside = new Uint8Array(tree.leaves.length);
    const leaves: number[] = [];
    centroids.forEach((c, i) => {
      if (c && volumes.some((v) => insideVolume(g, c, v.planes, 0))) { inside[i] = 1; leaves.push(i); }
    });
    const portals: number[] = [];
    graph.portals.forEach((p, i) => { if (inside[p.from] !== inside[p.to]) portals.push(i); });
    return { name, leaves, portals, seals: seals(graph, inside, portals) };
  });
}

/** True if the leaves just outside the door are not all connected without passing through it. */
function seals<D extends Dim>(graph: PortalGraph<D>, inside: Uint8Array, doorPortals: readonly number[]): boolean {
  const around = [...new Set(doorPortals.map((p) => graph.portals[p]).map((p) => (inside[p.from] ? p.to : p.from)))];
  if (around.length < 2) return false;
  const seen = new Uint8Array(graph.leafCount);
  const stack = [around[0]];
  seen[around[0]] = 1;
  while (stack.length) {
    const leaf = stack.pop()!;
    for (const pid of graph.portalsFrom[leaf]) {
      const to = graph.portals[pid].to;
      if (!seen[to] && !inside[to]) { seen[to] = 1; stack.push(to); }
    }
  }
  return around.some((l) => !seen[l]);
}

/**
 * Runtime door state → `portalOpen` for `visibleLeaves` / `lightLeaves`: 1 = open, 0 = closed by a
 * door in `closed` (names). Partly open doors should be passed as open (conservative).
 */
export function doorPortalOpen(portalCount: number, doors: readonly DoorInfo[], closed: Iterable<string>): Uint8Array {
  const open = new Uint8Array(portalCount).fill(1);
  for (const id of closedDoorPortals(doors, closed)) open[id] = 0;
  return open;
}

/** Ids of the portals sealed by the doors named in `closed` (for `packRuntime` / the export's `closed` flag). */
export function closedDoorPortals(doors: readonly DoorInfo[], closed: Iterable<string>): number[] {
  const shut = new Set(closed);
  return [...new Set(doors.filter((d) => shut.has(d.name)).flatMap((d) => d.portals))].sort((a, b) => a - b);
}
