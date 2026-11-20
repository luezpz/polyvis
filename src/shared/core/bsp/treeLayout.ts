/**
 * BSP tree shape for debugging balance: a tidy-ish 2D layout of the tree
 * (leaves spaced evenly in front-to-back order, each node centred over its
 * children, one row per depth) and balance statistics.
 *
 * Balance measures:
 * - mean leaf depth vs the ideal `log2(leafCount)` of a perfectly balanced tree;
 * - per-node imbalance `|F − B| / (F + B)` with `F`, `B` the leaf counts of the
 *   front / back subtrees (0 = even split, → 1 = degenerate "vine" node).
 *
 * Traversals are iterative: degenerate trees can be thousands of levels deep.
 */

import type { Dim } from "../geometry";
import { type BspTree, type ChildRef, isLeafRef, refToLeaf } from "./types";

/** Layout of every node and leaf; arrays are indexed by node index / leaf index. */
export interface BspTreeLayout {
  /** Horizontal position in leaf slots (0 .. leafSlots − 1); front subtree is to the left. */
  readonly nodeX: Float64Array;
  readonly leafX: Float64Array;
  /** Depth (root = 0). */
  readonly nodeDepth: Int32Array;
  readonly leafDepth: Int32Array;
  /** Parent node index, −1 for the root. */
  readonly nodeParent: Int32Array;
  readonly leafParent: Int32Array;
  /** Leaves under each node. */
  readonly nodeLeafCount: Int32Array;
  /** Node imbalance `|F − B| / (F + B)` (leaf counts of the front / back subtrees), 0..1. */
  readonly nodeImbalance: Float64Array;
  /** Number of leaf slots (= reachable leaves) and deepest depth. */
  readonly leafSlots: number;
  readonly maxDepth: number;
}

/** Balance summary of a tree (see the module comment). */
export interface BspBalance {
  readonly leafCount: number;
  readonly nodeCount: number;
  readonly minLeafDepth: number;
  readonly maxDepth: number;
  readonly meanLeafDepth: number;
  /** `log2(leafCount)`: mean leaf depth of a perfectly balanced tree. */
  readonly idealDepth: number;
  /** Mean of {@link BspTreeLayout.nodeImbalance} over all nodes (0 if none). */
  readonly meanImbalance: number;
}

/** Lays out `tree` (see {@link BspTreeLayout}). Unreachable nodes / leaves keep depth −1. */
export function bspTreeLayout<D extends Dim>(tree: BspTree<D>): BspTreeLayout {
  const nn = tree.nodes.length, nl = tree.leaves.length;
  const nodeX = new Float64Array(nn), leafX = new Float64Array(nl);
  const nodeDepth = new Int32Array(nn).fill(-1), leafDepth = new Int32Array(nl).fill(-1);
  const nodeParent = new Int32Array(nn).fill(-1), leafParent = new Int32Array(nl).fill(-1);
  const nodeLeafCount = new Int32Array(nn);
  const nodeImbalance = new Float64Array(nn);

  // Pre-order DFS, front first: leaves are met left to right, parents before children.
  const order: number[] = [];
  const stack: [ChildRef, number, number][] = [[tree.root, 0, -1]];
  let slot = 0, maxDepth = 0;
  while (stack.length > 0) {
    const [ref, depth, parent] = stack.pop()!;
    if (depth > maxDepth) maxDepth = depth;
    if (isLeafRef(ref)) {
      const l = refToLeaf(ref);
      leafX[l] = slot++;
      leafDepth[l] = depth;
      leafParent[l] = parent;
      continue;
    }
    nodeDepth[ref] = depth;
    nodeParent[ref] = parent;
    order.push(ref);
    const n = tree.nodes[ref];
    stack.push([n.back, depth + 1, ref], [n.front, depth + 1, ref]);
  }

  // Reverse pre-order visits children before parents: centre nodes, count leaves.
  const xOf = (r: ChildRef) => (isLeafRef(r) ? leafX[refToLeaf(r)] : nodeX[r]);
  const countOf = (r: ChildRef) => (isLeafRef(r) ? 1 : nodeLeafCount[r]);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const { front, back } = tree.nodes[id];
    nodeX[id] = (xOf(front) + xOf(back)) / 2;
    const f = countOf(front), b = countOf(back);
    nodeLeafCount[id] = f + b;
    nodeImbalance[id] = Math.abs(f - b) / (f + b);
  }

  return { nodeX, leafX, nodeDepth, leafDepth, nodeParent, leafParent, nodeLeafCount, nodeImbalance, leafSlots: slot, maxDepth };
}

/** Balance statistics of a laid-out tree. */
export function bspBalance(layout: BspTreeLayout): BspBalance {
  let leafCount = 0, sum = 0, min = Infinity;
  for (const d of layout.leafDepth) {
    if (d < 0) continue;
    leafCount++;
    sum += d;
    if (d < min) min = d;
  }
  let nodeCount = 0, imb = 0;
  layout.nodeDepth.forEach((d, i) => {
    if (d < 0) return;
    nodeCount++;
    imb += layout.nodeImbalance[i];
  });
  return {
    leafCount,
    nodeCount,
    minLeafDepth: leafCount > 0 ? min : 0,
    maxDepth: layout.maxDepth,
    meanLeafDepth: leafCount > 0 ? sum / leafCount : 0,
    idealDepth: leafCount > 0 ? Math.log2(leafCount) : 0,
    meanImbalance: nodeCount > 0 ? imb / nodeCount : 0,
  };
}

/** Leaves under `ref` (just `[leaf]` for a leaf ref), in front-to-back order. */
export function leavesUnder<D extends Dim>(tree: BspTree<D>, ref: ChildRef): number[] {
  const out: number[] = [];
  const stack = [ref];
  while (stack.length > 0) {
    const r = stack.pop()!;
    if (isLeafRef(r)) { out.push(refToLeaf(r)); continue; }
    stack.push(tree.nodes[r].back, tree.nodes[r].front);
  }
  return out;
}
