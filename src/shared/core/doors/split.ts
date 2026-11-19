/**
 * Door leaf splits (phase 4b): door brushes are not structural (the level is baked with every door
 * open), so the BSP does not follow their faces and a leaf may straddle a door. This pass splits each
 * empty leaf that overlaps a door volume along the volume's planes, so afterwards every empty leaf is
 * either inside one door's volume or outside it, and the door's boundary portals separate the two.
 *
 * Splitting only subdivides empty leaves (no contents change), so the baked PVS stays conservative.
 */

import type { BspLeaf, BspNode, BspTree, ChildRef } from "../bsp";
import { isLeafRef, leafRef, refToLeaf } from "../bsp";
import type { Cell, Dim, Geometry, Plane } from "../geometry";
import { PROBE_OFFSET } from "../math";
import { type DoorVolume, cellCentroid, insideVolume } from "./types";

/** Result of {@link splitLeavesByDoors}: the new tree and how many splits it added. */
export interface DoorSplitResult<D extends Dim> {
  readonly tree: BspTree<D>;
  readonly splitCount: number;
}

/**
 * Returns `tree` with every empty leaf overlapping a door volume split along the volume's planes.
 * Leaf indices of unsplit leaves are kept; a split leaf keeps its index for its first piece and
 * the other pieces are appended. Returns the input tree unchanged when nothing overlaps.
 */
export function splitLeavesByDoors<D extends Dim>(g: Geometry<D>, tree: BspTree<D>, doors: readonly DoorVolume<D>[]): DoorSplitResult<D> {
  const planes = [...tree.planes];
  const nodes: BspNode<D>[] = [...tree.nodes];
  const leaves: BspLeaf<D>[] = [...tree.leaves];
  let root = tree.root;
  let splitCount = 0;

  const intern = (plane: Plane<D>): number => {
    const i = planes.findIndex((p) => g.sameOrientedPlane(p, plane));
    if (i >= 0) return i;
    planes.push(plane);
    return planes.length - 1;
  };

  for (const door of doors) {
    // Parent slot of each leaf (node index and side, or root), rebuilt per door since splits move leaves.
    const parent = new Map<number, { node: number; front: boolean } | null>();
    if (isLeafRef(root)) parent.set(refToLeaf(root), null);
    nodes.forEach((n, i) => {
      if (isLeafRef(n.front)) parent.set(refToLeaf(n.front), { node: i, front: true });
      if (isLeafRef(n.back)) parent.set(refToLeaf(n.back), { node: i, front: false });
    });
    const count = leaves.length;
    for (let li = 0; li < count; li++) {
      const leaf = leaves[li];
      if (leaf.contents !== "empty" || !leaf.region || !overlaps(g, leaf.region, door.planes)) continue;
      let reuse = true; // first piece takes the leaf's own slot
      const addLeaf = (region: Cell<D> | null, depth: number): ChildRef => {
        const piece: BspLeaf<D> = { contents: "empty", region, depth };
        if (reuse) { reuse = false; leaves[li] = piece; return leafRef(li); }
        leaves.push(piece);
        return leafRef(leaves.length - 1);
      };
      /** Splits `region` by the door planes from `k` on; the back (outside) side of each cut is final. */
      const split = (region: Cell<D>, k: number, depth: number): ChildRef => {
        for (; k < door.planes.length; k++) if (cuts(g, region, door.planes[k])) break;
        if (k === door.planes.length) return addLeaf(region, depth);
        const plane = door.planes[k], tag = intern(plane);
        splitCount++;
        const nodeIndex = nodes.length;
        nodes.push(null as unknown as BspNode<D>);
        const inside = g.clipCell(region, plane, tag), outside = g.clipCell(region, g.flipPlane(plane), tag);
        const front = inside ? split(inside, k + 1, depth + 1) : addLeaf(null, depth + 1);
        const back = addLeaf(outside, depth + 1);
        nodes[nodeIndex] = { plane: tag, front, back, region };
        return nodeIndex;
      };
      const ref = split(leaf.region, 0, leaf.depth);
      if (ref === leafRef(li)) continue; // nothing cut after all
      const slot = parent.get(li);
      if (!slot) root = ref;
      else nodes[slot.node] = slot.front ? { ...nodes[slot.node], front: ref } : { ...nodes[slot.node], back: ref };
    }
  }
  return splitCount ? { tree: { planes, nodes, leaves, root, bounds: tree.bounds }, splitCount } : { tree, splitCount };
}

/** True if `plane` cuts `region` into two parts both thicker than the probe offset. */
function cuts<D extends Dim>(g: Geometry<D>, region: Cell<D>, plane: Plane<D>): boolean {
  let front = 0, back = 0;
  for (const p of g.cellVertices(region)) {
    const s = g.signedDistance(plane, p);
    if (s > front) front = s;
    if (-s > back) back = -s;
  }
  return front > PROBE_OFFSET && back > PROBE_OFFSET;
}

/**
 * True if `region` and the door volume (front of every plane) share interior: the centroid of
 * their intersection lies deeper than the probe offset inside every plane (thinner overlaps are ignored).
 */
function overlaps<D extends Dim>(g: Geometry<D>, region: Cell<D>, planes: readonly Plane<D>[]): boolean {
  let cell: Cell<D> | null = region;
  for (const p of planes) {
    cell = g.clipCell(cell, p, -1); // tag unused: the cell is thrown away
    if (!cell) return false;
  }
  return insideVolume(g, cellCentroid(g, cell), planes, PROBE_OFFSET);
}
