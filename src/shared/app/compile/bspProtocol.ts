/**
 * Messages between the compile worker and its pool workers for the parallel
 * BSP build (see `shared/core/bsp/parallelBuild.ts`). Walls and subtrees travel
 * packed (`shared/core/bsp/pack.ts`); task regions are small plain objects.
 */

import type { BspBuildOptions, Dim, FragmentSource, PackedSubtree, RemoteTask, SplitChoice } from "../../core";

export type BspRequest =
  | { readonly type: "bsp-begin"; readonly id: number; readonly walls: Float64Array; readonly opts: BspBuildOptions }
  | { readonly type: "bsp-score"; readonly id: number; readonly source: FragmentSource; readonly candidates: readonly number[] }
  | { readonly type: "bsp-subtree"; readonly id: number; readonly task: RemoteTask<Dim> };

export type BspResponse =
  | { readonly id: number; readonly ok: true }
  | { readonly id: number; readonly choice: SplitChoice }
  | { readonly id: number; readonly subtree: PackedSubtree<Dim> }
  | { readonly id: number; readonly error: string };
