/**
 * The BSP stage bound to 3D: the algorithms live in `shared/core/bsp` and run
 * on {@link geometry3}; this module fixes the types and the 3D defaults.
 */

import * as shared from "../../../shared/core";
import type { Wall } from "../csg";
import { type Dim3, geometry3 } from "../geometry";

export {
  type BspBuildOptions, type BspStats, type ChildRef, type LeafContents, type RefineOptions,
  BOUNDS_TAG, isLeafRef, leafRef, refToLeaf,
} from "../../../shared/core";

export type BspNode = shared.BspNode<Dim3>;
export type BspLeaf = shared.BspLeaf<Dim3>;
export type BspTree = shared.BspTree<Dim3>;
export type BspBuildResult = shared.BspBuildResult<Dim3>;
/** A piece of a wall bounding an empty leaf; the winding is CCW seen from the leaf. */
export type LeafSurface = shared.LeafSurface<Dim3>;

export const DEFAULT_BSP_OPTIONS: shared.BspBuildOptions = Object.freeze({
  splitWeight: 8,
  balanceWeight: 1,
  boundsMargin: 4,
  cornerSplits: true,
  minCellSize: 1,
  maxCellSize: 0,
});

/** Builds the solid-leaf BSP of `walls` (empty space in front of each). */
export const buildBsp = (walls: readonly Wall[], options: Partial<shared.BspBuildOptions> = {}): BspBuildResult =>
  shared.buildBsp(geometry3, walls, { ...DEFAULT_BSP_OPTIONS, ...options });

/** `surfaces[leaf]` = the wall pieces bounding each empty leaf. */
export const buildLeafSurfaces = (tree: BspTree, walls: readonly Wall[]): LeafSurface[][] => shared.buildLeafSurfaces(geometry3, tree, walls);
