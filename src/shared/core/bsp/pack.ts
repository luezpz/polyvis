/**
 * Flat encodings of the parallel BSP build's messages (walls in, subtrees
 * out). Structured-cloning the object graphs cost more than building the
 * tree: a 4k-wall level's regions took ~200 ms to clone, a `Float64Array` of
 * them is a memcpy. Uses the `Geometry` pack ops for facets and cells.
 */

import type { Cell, Dim, Geometry, Plane } from "../geometry";
import type { Wall } from "../wall";
import type { Subtree } from "./build";
import type { BspLeaf, BspNode } from "./types";

/** A {@link Subtree} as numbers: `nodes` = `plane front back` per node; `leaves` = `solid depth` per leaf; `regions` = node then leaf regions, each `0` (null) or `1` + cell. */
export interface PackedSubtree<D extends Dim> {
  readonly newPlanes: readonly Plane<D>[];
  readonly nodes: Int32Array;
  readonly leaves: Int32Array;
  readonly regions: Float64Array;
  readonly root: number;
  readonly splitCount: number;
  readonly refineSplitCount: number;
}

/** Walls as `count`, then per wall: normal (dimension numbers), `d`, `sourceId`, `splitBias` (0 = none), facet. */
export function packWalls<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[]): Float64Array {
  const out: number[] = [walls.length];
  for (const w of walls) {
    out.push(...g.coords(w.plane.n), w.plane.d, w.sourceId, w.splitBias ?? 0);
    g.packFacet(w.winding, out);
  }
  return Float64Array.from(out);
}

/** Inverse of {@link packWalls}. */
export function unpackWalls<D extends Dim>(g: Geometry<D>, data: ArrayLike<number>): Wall<D>[] {
  const walls: Wall<D>[] = new Array(data[0]);
  let at = 1;
  for (let i = 0; i < walls.length; i++) {
    const n = g.vecAt(data, at);
    at += g.dimension;
    const plane = { n, d: data[at] };
    const sourceId = data[at + 1];
    const splitBias = data[at + 2];
    const [winding, next] = g.unpackFacet(data, at + 3);
    walls[i] = splitBias ? { winding, plane, sourceId, splitBias } : { winding, plane, sourceId };
    at = next;
  }
  return walls;
}

/** Packs a subtree for the trip back to the main thread. */
export function packSubtree<D extends Dim>(g: Geometry<D>, t: Subtree<D>): PackedSubtree<D> {
  const nodes = new Int32Array(t.nodes.length * 3);
  const leaves = new Int32Array(t.leaves.length * 2);
  const regions: number[] = [];
  const region = (c: Cell<D> | null) => {
    if (!c) return void regions.push(0);
    regions.push(1);
    g.packCell(c, regions);
  };
  t.nodes.forEach((n, i) => {
    nodes.set([n.plane, n.front, n.back], i * 3);
    region(n.region);
  });
  t.leaves.forEach((l, i) => {
    leaves.set([l.contents === "solid" ? 1 : 0, l.depth], i * 2);
    region(l.region);
  });
  return { newPlanes: t.newPlanes, nodes, leaves, regions: Float64Array.from(regions), root: t.root, splitCount: t.splitCount, refineSplitCount: t.refineSplitCount };
}

/** Inverse of {@link packSubtree}. */
export function unpackSubtree<D extends Dim>(g: Geometry<D>, p: PackedSubtree<D>): Subtree<D> {
  let at = 0;
  const region = (): Cell<D> | null => {
    if (p.regions[at++] === 0) return null;
    const [cell, next] = g.unpackCell(p.regions, at);
    at = next;
    return cell;
  };
  const nodes: BspNode<D>[] = new Array(p.nodes.length / 3);
  for (let i = 0; i < nodes.length; i++) nodes[i] = { plane: p.nodes[i * 3], front: p.nodes[i * 3 + 1], back: p.nodes[i * 3 + 2], region: region() };
  const leaves: BspLeaf<D>[] = new Array(p.leaves.length / 2);
  for (let i = 0; i < leaves.length; i++) leaves[i] = { contents: p.leaves[i * 2] === 1 ? "solid" : "empty", region: region(), depth: p.leaves[i * 2 + 1] };
  return { newPlanes: p.newPlanes, nodes, leaves, root: p.root, splitCount: p.splitCount, refineSplitCount: p.refineSplitCount };
}
