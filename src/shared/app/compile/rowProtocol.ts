/**
 * Messages between the compile worker and its pool workers for the row-parallel stages, base vis
 * and the passage table (`shared/core/vis/parallelRows.ts`). Inputs are packed (`RowWorker.begin`).
 */

import type { RowJob } from "../../core";

export type RowRequest =
  | { readonly type: "rows-begin"; readonly id: number; readonly job: RowJob; readonly graph: Float64Array; readonly mightSee: Uint32Array | null }
  | { readonly type: "rows"; readonly id: number; readonly p0: number; readonly p1: number };

/** `words`: packed rows of portals `[p0, p1)`, transferred (not copied) back. */
export type RowResponse =
  | { readonly id: number; readonly ok: true }
  | { readonly id: number; readonly words: Uint32Array }
  | { readonly id: number; readonly error: string };
