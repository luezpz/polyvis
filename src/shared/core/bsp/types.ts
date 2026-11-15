/**
 * BSP tree data structures.
 *
 * The tree is stored in flat arrays (Quake-style) so it can be exported to a
 * game engine verbatim:
 *
 * - `planes[i]` — oriented splitting planes (lines in 2D). Walls on the same plane
 *   (with the same orientation) share a plane.
 * - `nodes[i]` — interior nodes. `front`/`back` are *child references*:
 *   `ref >= 0` is a node index, `ref < 0` is the leaf `~ref` (i.e. `-ref - 1`).
 * - `leaves[i]` — convex cells. Each is either solid or empty.
 *
 * This is a *solid-leaf* BSP: walls are oriented with empty space in front, so
 * after all walls have been used as splitters every leaf is unambiguously solid
 * (behind a wall) or empty (in front of all walls bounding it).
 */

import type { Bounds, Cell, Dim, Plane } from "../geometry";

/** Child reference: `>= 0` node index, `< 0` leaf index encoded as `~leaf`. */
export type ChildRef = number;

export const leafRef = (leaf: number): ChildRef => ~leaf;
export const isLeafRef = (ref: ChildRef): boolean => ref < 0;
export const refToLeaf = (ref: ChildRef): number => ~ref;

/** Tag of the leaf-region boundary pieces (2D edges, 3D faces) that come from the outer bounding box rather than a BSP plane. */
export const BOUNDS_TAG = -2;

export type LeafContents = "empty" | "solid";

export interface BspNode<D extends Dim> {
  /** Index into {@link BspTree.planes}. Front child is on the side the plane normal points to. */
  readonly plane: number;
  readonly front: ChildRef;
  readonly back: ChildRef;
  /** Convex region of space covered by this node (bounds clipped by all ancestor planes). */
  readonly region: Cell<D> | null;
}

export interface BspLeaf<D extends Dim> {
  readonly contents: LeafContents;
  /**
   * Convex region of the leaf, clipped to the level bounds. Boundary tags are
   * plane indices (or {@link BOUNDS_TAG}). Null if the leaf is degenerate (can
   * happen with nearly-parallel splitters).
   */
  readonly region: Cell<D> | null;
  /** Depth of the leaf in the tree (root children have depth 1). */
  readonly depth: number;
}

export interface BspTree<D extends Dim> {
  readonly planes: readonly Plane<D>[];
  readonly nodes: readonly BspNode<D>[];
  readonly leaves: readonly BspLeaf<D>[];
  /** Root reference (a leaf reference if the level has no walls). */
  readonly root: ChildRef;
  /** Bounding box used to close off leaf regions. */
  readonly bounds: Bounds<D>;
}

export interface BspStats {
  readonly nodeCount: number;
  readonly leafCount: number;
  readonly emptyLeafCount: number;
  readonly solidLeafCount: number;
  readonly maxDepth: number;
  /** Number of wall fragments created by splitting. */
  readonly splitCount: number;
  /** Number of extra empty-leaf splits (corner extensions and cell size limits). */
  readonly refineSplitCount: number;
}
