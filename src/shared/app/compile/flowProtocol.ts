/**
 * Messages between the compile worker and its portal-flow workers (see
 * `shared/core/vis/parallelFlow.ts`). `BitSet`s arrive as `{ size, words }`
 * after the structured clone; {@link toBitSet} restores them.
 */

import { BitSet, type Dim, type FlowRow, type PortalGraph, type SourceFlow } from "../../core";

export type FlowRequest =
  | { readonly type: "begin"; readonly id: number; readonly graph: PortalGraph<Dim>; readonly mightSee: readonly BitSet[]; readonly clipSource: boolean; readonly rank: Int32Array }
  | { readonly type: "flow"; readonly id: number; readonly known: readonly FlowRow[]; readonly sources: readonly number[]; readonly budget: number };

export type FlowResponse =
  | { readonly id: number; readonly results: readonly SourceFlow[] }
  | { readonly id: number; readonly error: string };

/** Restores a structured-cloned `BitSet`. */
export const toBitSet = (b: { readonly size: number; readonly words: Uint32Array }): BitSet => new BitSet(b.size, b.words);
