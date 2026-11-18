/**
 * Messages between the compile worker and its pool workers for the parallel passage table build
 * (`shared/core/vis/parallelPassages.ts`). Inputs are packed (`PassageWorker.begin`).
 */

export type PassageRequest =
  | { readonly type: "passage-begin"; readonly id: number; readonly graph: Float64Array; readonly mightSee: Uint32Array }
  | { readonly type: "passage-rows"; readonly id: number; readonly p0: number; readonly p1: number };

/** `words`: rows of portals `[p0, p1)`, transferred (not copied) back. */
export type PassageResponse =
  | { readonly id: number; readonly ok: true }
  | { readonly id: number; readonly words: Uint32Array }
  | { readonly id: number; readonly error: string };
