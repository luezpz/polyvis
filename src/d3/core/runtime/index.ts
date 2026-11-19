/** Runtime portal clipping (phase 4), bound to the 3D kernel. */

import * as shared from "../../../shared/core";
import type { BitSet, PvsTable, RuntimeData, ScreenRect, VisibleLeavesOptions } from "../../../shared/core";
import type { BspTree } from "../bsp";
import { type Dim3, geometry3 } from "../geometry";
import type { Aabb, Vec3 } from "../math";
import type { PortalGraph } from "../portals";

export { portalFrustum3 } from "./portalFrustum";
export { viewToward } from "./view";
export type { ClipMode, RuntimeData, ScreenRect } from "../../../shared/core";
export { anyVisible, fullRect, intersectRects, runtimePvsRow } from "../../../shared/core";
export type View = shared.View<Dim3>;
export type RuntimeOptions = VisibleLeavesOptions<Dim3>;

/** Leaves visible from `eye` in `cameraLeaf`; `opts.clip`: "planes" (precise) or "rect" (cheap; omnidirectional without `view`). */
export const visibleLeaves = (graph: PortalGraph, cameraLeaf: number, eye: Vec3, opts: RuntimeOptions = {}): BitSet =>
  shared.visibleLeaves(geometry3, graph, cameraLeaf, eye, opts);
/** Side planes of `view` at `eye` (front = inside). */
export const viewFrustum = (eye: Vec3, view: View) => shared.viewFrustum(geometry3, eye, view);
/** Screen rect of `points` (null: all behind the eye; "all": straddles the eye plane). */
export const projectRect = (eye: Vec3, view: View, points: readonly Vec3[]): ScreenRect | null | "all" => shared.projectRect(geometry3, eye, view, points);
/** Empty leaves an object's bounding box touches (register once per move). */
export const leavesInBounds = (tree: BspTree, box: Aabb): number[] => shared.leavesInBounds(geometry3, tree, box);
/** Leaves a point light reaches (portal clipping from the light, within `radius`). */
export const lightLeaves = (tree: BspTree, graph: PortalGraph, leaf: number, pos: Vec3, radius: number, opts: Pick<RuntimeOptions, "pvsRow" | "portalOpen"> = {}): number[] =>
  shared.lightLeaves(geometry3, tree, graph, leaf, pos, radius, opts);
/** Flat typed-array export for engines (see `shared/core/runtime/pack.ts` for the layout). */
export const packRuntime = (graph: PortalGraph, pvs: PvsTable, closed: Iterable<number> = []): RuntimeData => shared.packRuntime(geometry3, graph, pvs, closed);
