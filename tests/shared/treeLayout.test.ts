/** BSP tree layout / balance stats (tree diagram debug view): hand-built trees plus real levels in both kernels. */

import { describe, expect, it } from "vitest";
import { type BspTree, type Dim, bspBalance, bspTreeLayout, leafRef, leavesUnder } from "../../src/shared/core";
import * as d2 from "../../src/d2/core";
import * as d3 from "../../src/d3/core";

/** A shape-only tree: `nodes` as [front, back] child refs; regions / planes are irrelevant here. */
function shape(nodes: [number, number][], leafCount: number, root = 0): BspTree<Dim> {
  return {
    planes: [],
    nodes: nodes.map(([front, back]) => ({ plane: 0, front, back, region: null })),
    leaves: Array.from({ length: leafCount }, () => ({ contents: "empty" as const, region: null, depth: 0 })),
    root,
    bounds: null as never,
  };
}

describe("bspTreeLayout", () => {
  it("lays out a balanced tree: leaves left to right, nodes centred, zero imbalance", () => {
    // root 0 → (1, 2); 1 → (L0, L1); 2 → (L2, L3)
    const t = shape([[1, 2], [leafRef(0), leafRef(1)], [leafRef(2), leafRef(3)]], 4);
    const l = bspTreeLayout(t);
    expect([...l.leafX]).toEqual([0, 1, 2, 3]);
    expect([...l.nodeX]).toEqual([1.5, 0.5, 2.5]);
    expect([...l.leafDepth]).toEqual([2, 2, 2, 2]);
    expect([...l.nodeParent]).toEqual([-1, 0, 0]);
    expect([...l.nodeLeafCount]).toEqual([4, 2, 2]);
    const b = bspBalance(l);
    expect(b).toMatchObject({ leafCount: 4, nodeCount: 3, minLeafDepth: 2, maxDepth: 2, meanLeafDepth: 2, idealDepth: 2, meanImbalance: 0 });
  });

  it("measures a vine (degenerate) tree", () => {
    // 0 → (L0, 1); 1 → (L1, 2); 2 → (L2, L3)
    const t = shape([[leafRef(0), 1], [leafRef(1), 2], [leafRef(2), leafRef(3)]], 4);
    const l = bspTreeLayout(t);
    expect([...l.leafDepth]).toEqual([1, 2, 3, 3]);
    expect(l.nodeImbalance[0]).toBeCloseTo(2 / 4);
    expect(l.nodeImbalance[1]).toBeCloseTo(1 / 3);
    const b = bspBalance(l);
    expect(b.maxDepth).toBe(3);
    expect(b.meanLeafDepth).toBeCloseTo(9 / 4);
    expect(leavesUnder(t, 1)).toEqual([1, 2, 3]);
    expect(leavesUnder(t, leafRef(0))).toEqual([0]);
  });

  it("handles a leaf-only tree", () => {
    const b = bspBalance(bspTreeLayout(shape([], 1, leafRef(0))));
    expect(b).toMatchObject({ leafCount: 1, nodeCount: 0, maxDepth: 0, idealDepth: 0 });
  });

  it.each([
    ["2D", () => d2.compileLevel(d2.SAMPLE_LEVELS[0].create()).tree as BspTree<Dim>],
    ["3D", () => d3.compileLevel(d3.SAMPLE_LEVELS[0].create()).tree as BspTree<Dim>],
  ])("agrees with the builder's leaf depths and covers every leaf (%s)", (_, build) => {
    const tree = build();
    const l = bspTreeLayout(tree);
    tree.leaves.forEach((leaf, i) => expect(l.leafDepth[i]).toBe(leaf.depth));
    expect(l.leafSlots).toBe(tree.leaves.length);
    expect(new Set(l.leafX).size).toBe(tree.leaves.length);
  });
});
