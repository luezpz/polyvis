/**
 * Bounding volume hierarchy over axis-aligned boxes, in any dimension.
 *
 * Used for broad-phase culling in CSG (which brushes can touch a face or contain a
 * probe point), after three-bvh-csg's use of a BVH to find candidate triangle pairs.
 * Plain numbers only (no `Geometry`): boxes are flat `min..., max...` rows, so both
 * kernels fill them from their own vector types.
 *
 * Build: top-down, split at the median centroid of the box's widest centroid axis,
 * O(n log² n). Queries return item indices in **ascending order**, so callers that
 * scanned items in index order (order-dependent fragmentation) get the same sequence.
 */

/** A built BVH. `k`: dimension. Treat the arrays as opaque. */
export interface Bvh {
  readonly k: number;
  readonly count: number;
  /** Node boxes, `2k` numbers per node (min then max). */
  readonly boxes: Float64Array;
  /** Per node: first child (internal) or first item slot (leaf). */
  readonly first: Int32Array;
  /** Per node: item count for leaves, -1 for internal nodes (children `first`, `first + 1`). */
  readonly size: Int32Array;
  /** Item ids in leaf order. */
  readonly items: Int32Array;
}

/** Items per leaf: small, since a leaf test is one box overlap per item. */
const LEAF_SIZE = 4;

/**
 * Builds a BVH. `boxes`: `n` rows of `2k` numbers (`min[0..k), max[0..k)`), item i = row i.
 * Returns a BVH whose queries report the row indices.
 */
export function buildBvh(boxes: ArrayLike<number>, k: number): Bvh {
  const w = 2 * k;
  const count = Math.floor(boxes.length / w);
  const items = Int32Array.from({ length: count }, (_, i) => i);
  const maxNodes = Math.max(1, 2 * count - 1);
  const nb = new Float64Array(maxNodes * w);
  const first = new Int32Array(maxNodes);
  const size = new Int32Array(maxNodes);
  const centre = (i: number, a: number) => boxes[i * w + a] + boxes[i * w + k + a];
  let nodes = 1;

  // Explicit stack of (node, lo, hi) over `items`.
  const stack: number[] = [0, 0, count];
  while (stack.length) {
    const hi = stack.pop()!, lo = stack.pop()!, node = stack.pop()!;
    const o = node * w;
    for (let a = 0; a < k; a++) {
      nb[o + a] = Infinity;
      nb[o + k + a] = -Infinity;
    }
    for (let s = lo; s < hi; s++) {
      const r = items[s] * w;
      for (let a = 0; a < k; a++) {
        if (boxes[r + a] < nb[o + a]) nb[o + a] = boxes[r + a];
        if (boxes[r + k + a] > nb[o + k + a]) nb[o + k + a] = boxes[r + k + a];
      }
    }
    if (hi - lo <= LEAF_SIZE) {
      first[node] = lo;
      size[node] = hi - lo;
      continue;
    }
    // Widest centroid spread.
    let axis = 0, best = -1;
    for (let a = 0; a < k; a++) {
      let mn = Infinity, mx = -Infinity;
      for (let s = lo; s < hi; s++) {
        const c = centre(items[s], a);
        if (c < mn) mn = c;
        if (c > mx) mx = c;
      }
      if (mx - mn > best) (best = mx - mn), (axis = a);
    }
    const sorted = Array.from(items.subarray(lo, hi)).sort((x, y) => centre(x, axis) - centre(y, axis));
    items.set(sorted, lo);
    const mid = (lo + hi) >>> 1;
    const left = nodes;
    nodes += 2;
    first[node] = left;
    size[node] = -1;
    stack.push(left, lo, mid, left + 1, mid, hi);
  }
  return { k, count, boxes: nb.slice(0, nodes * w), first: first.slice(0, nodes), size: size.slice(0, nodes), items };
}

/**
 * Ids of items whose box overlaps `[min − eps, max + eps]` (boundary contact counts),
 * ascending. `itemBoxes`: the rows the BVH was built from.
 */
export function bvhQueryBox(bvh: Bvh, itemBoxes: ArrayLike<number>, min: ArrayLike<number>, max: ArrayLike<number>, eps = 0): number[] {
  const { k, boxes, first, size, items } = bvh;
  const out: number[] = [];
  if (bvh.count === 0) return out;
  const overlaps = (src: ArrayLike<number>, o: number): boolean => {
    for (let a = 0; a < k; a++) if (src[o + a] > max[a] + eps || src[o + k + a] < min[a] - eps) return false;
    return true;
  };
  const stack = [0];
  while (stack.length) {
    const node = stack.pop()!;
    if (!overlaps(boxes, node * 2 * k)) continue;
    if (size[node] < 0) {
      stack.push(first[node], first[node] + 1);
      continue;
    }
    for (let s = first[node]; s < first[node] + size[node]; s++) if (overlaps(itemBoxes, items[s] * 2 * k)) out.push(items[s]);
  }
  return out.sort((a, b) => a - b);
}

/**
 * True if `pred(id)` holds for some item whose box contains `p` (inflated by `eps`). Stops at the
 * first hit; no allocation beyond a small stack. Visit order is unspecified (use for `some`-style tests).
 */
export function bvhAnyAt(bvh: Bvh, itemBoxes: ArrayLike<number>, p: ArrayLike<number>, eps: number, pred: (id: number) => boolean): boolean {
  const { k, boxes, first, size, items } = bvh;
  if (bvh.count === 0) return false;
  const contains = (src: ArrayLike<number>, o: number): boolean => {
    for (let a = 0; a < k; a++) if (src[o + a] > p[a] + eps || src[o + k + a] < p[a] - eps) return false;
    return true;
  };
  const stack = [0];
  while (stack.length) {
    const node = stack.pop()!;
    if (!contains(boxes, node * 2 * k)) continue;
    if (size[node] < 0) {
      stack.push(first[node], first[node] + 1);
      continue;
    }
    for (let s = first[node]; s < first[node] + size[node]; s++) if (contains(itemBoxes, items[s] * 2 * k) && pred(items[s])) return true;
  }
  return false;
}
