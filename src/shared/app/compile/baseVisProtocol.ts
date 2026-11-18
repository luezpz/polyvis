/**
 * Messages between the compile worker and its pool workers for parallel base vis
 * (`shared/core/vis/parallelBaseVis.ts`). The graph is packed (`BaseVisWorker.begin`).
 */

export type BaseVisRequest =
  | { readonly type: "basevis-begin"; readonly id: number; readonly graph: Float64Array }
  | { readonly type: "basevis-rows"; readonly id: number; readonly p0: number; readonly p1: number };

/** `words`: packed rows of portals `[p0, p1)`, transferred (not copied) back. */
export type BaseVisResponse =
  | { readonly id: number; readonly ok: true }
  | { readonly id: number; readonly words: Uint32Array }
  | { readonly id: number; readonly error: string };
