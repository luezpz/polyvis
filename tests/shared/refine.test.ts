/**
 * Corner-split refinement, both dimensions: a wall touching an empty leaf as
 * the solid-leaf build left it must split every cell refinement cuts from that
 * leaf, regardless of split order.
 */

import { describe, expect, it } from "vitest";
import { type BspTree, type Cell, type ChildRef, type Dim, type Geometry, type Wall, isLeafRef, refToLeaf } from "../../src/shared/core";
import { PROBE_OFFSET } from "../../src/shared/core/math";
import { SAMPLE_LEVELS as SAMPLES_2D, buildBsp as buildBsp2, buildWalls as buildWalls2 } from "../../src/d2/core";
import { SAMPLE_LEVELS as SAMPLES_3D, buildBsp as buildBsp3, buildWalls as buildWalls3 } from "../../src/d3/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";

interface Case {
  readonly name: string;
  readonly g: Geometry<Dim>;
  readonly build: () => { walls: readonly Wall<Dim>[]; tree: BspTree<Dim> };
}

const opts = { cornerSplits: true, minCellSize: 0, maxCellSize: 0 };
const cases: Case[] = [
  ...SAMPLES_2D.map((s) => ({
    name: `2D ${s.name}`,
    g: geometry2 as unknown as Geometry<Dim>,
    build: () => {
      const walls = buildWalls2(s.create().brushes);
      return { walls, tree: buildBsp2(walls, opts).tree } as unknown as ReturnType<Case["build"]>;
    },
  })),
  ...SAMPLES_3D.map((s) => ({
    name: `3D ${s.name}`,
    g: geometry3 as unknown as Geometry<Dim>,
    build: () => {
      const walls = buildWalls3(s.create().brushes);
      return { walls, tree: buildBsp3(walls, opts).tree } as unknown as ReturnType<Case["build"]>;
    },
  })),
];

/**
 * For each empty leaf, the region of its highest ancestor whose subtree holds
 * only empty leaves: the empty leaf the solid-leaf build produced, before
 * refinement cut it up. Returns `origin[leaf]`.
 */
function refinementOrigins<D extends Dim>(tree: BspTree<D>): Map<number, Cell<D>> {
  const origin = new Map<number, Cell<D>>();
  /** Visits `ref`; `top` is the all-empty ancestor region so far (null above it). Returns true if the subtree is all empty. */
  const allEmpty = (ref: ChildRef): boolean => {
    if (isLeafRef(ref)) return tree.leaves[refToLeaf(ref)].contents === "empty";
    const n = tree.nodes[ref];
    return allEmpty(n.front) && allEmpty(n.back);
  };
  const visit = (ref: ChildRef, top: Cell<D> | null): void => {
    if (isLeafRef(ref)) {
      const leaf = tree.leaves[refToLeaf(ref)];
      if (leaf.contents === "empty" && leaf.region) origin.set(refToLeaf(ref), top ?? leaf.region);
      return;
    }
    const n = tree.nodes[ref];
    const t = top ?? (allEmpty(ref) ? n.region : null);
    visit(n.front, t);
    visit(n.back, t);
  };
  visit(tree.root, null);
  return origin;
}

describe("corner splits", () => {
  it.each(cases)("$name: walls touching the pre-refinement leaf split all its cells", ({ g, build }) => {
    const { walls, tree } = build();
    let misses = 0;
    for (const [leaf, origin] of refinementOrigins(tree)) {
      const vs = g.cellVertices(tree.leaves[leaf].region!);
      for (const w of walls) {
        if (!g.wallTouchesCell(w.winding, origin)) continue;
        let front = 0, back = 0;
        for (const p of vs) {
          const s = g.signedDistance(w.plane, p);
          front = Math.max(front, s);
          back = Math.max(back, -s);
        }
        if (Math.min(front, back) >= PROBE_OFFSET) misses++;
      }
    }
    expect(misses).toBe(0);
  });
});
