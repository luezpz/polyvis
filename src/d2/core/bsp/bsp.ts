/**
 * The BSP stage bound to 2D: the algorithms live in `shared/core/bsp` and run
 * on {@link geometry2}; this module fixes the types and the 2D defaults.
 */

import * as shared from "../../../shared/core";
import type { Wall } from "../csg";
import { type Dim2, geometry2 } from "../geometry";

export {
  type BspBuildOptions, type BspStats, type ChildRef, type LeafContents, type RefineOptions,
  BOUNDS_TAG, isLeafRef, leafRef, refToLeaf,
} from "../../../shared/core";

export type BspNode = shared.BspNode<Dim2>;
export type BspLeaf = shared.BspLeaf<Dim2>;
export type BspTree = shared.BspTree<Dim2>;
export type BspBuildResult = shared.BspBuildResult<Dim2>;
/** A piece of a wall bounding an empty leaf; the leaf is on the left of its segment. */
export type LeafSurface = shared.LeafSurface<Dim2>;

export const DEFAULT_BSP_OPTIONS: shared.BspBuildOptions = Object.freeze({
  splitWeight: 8,
  balanceWeight: 1,
  boundsMargin: 4,
  cornerSplits: false,
  minCellSize: 0.5,
  maxCellSize: 0,
});

/** Builds the solid-leaf BSP of `walls` (empty space in front of each). */
export const buildBsp = (walls: readonly Wall[], options: Partial<shared.BspBuildOptions> = {}): BspBuildResult =>
  shared.buildBsp(geometry2, walls, { ...DEFAULT_BSP_OPTIONS, ...options });

/** `surfaces[leaf]` = the wall pieces bounding each empty leaf. */
export const buildLeafSurfaces = (tree: BspTree, walls: readonly Wall[]): LeafSurface[][] => shared.buildLeafSurfaces(geometry2, tree, walls);
