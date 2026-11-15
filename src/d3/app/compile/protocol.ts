/**
 * Messages between the editor and the compile worker.
 *
 * Results cross the worker boundary by structured clone, which keeps plain
 * objects and typed arrays but drops class prototypes: {@link hydrateResult}
 * turns the cloned `{ size, words }` objects back into `BitSet`s.
 */

import { type CompileOptions, type CompileResult, type Level, BitSet } from "../../core";

export interface CompileRequest {
  readonly id: number;
  readonly level: Level;
  readonly options: Partial<CompileOptions>;
}

export type CompileResponse =
  | { readonly id: number; readonly result: CompileResult; readonly ms: number }
  | { readonly id: number; readonly error: string };

type ClonedBitSet = { readonly size: number; readonly words: Uint32Array };

const toBitSet = (b: ClonedBitSet): BitSet => new BitSet(b.size, b.words);

/** Restores class instances lost in a structured clone. */
export function hydrateResult(raw: CompileResult): CompileResult {
  const fix = (rows: readonly unknown[]) => rows.map((r) => toBitSet(r as ClonedBitSet));
  return {
    ...raw,
    mightSee: fix(raw.mightSee),
    portalVis: fix(raw.portalVis),
    pvs: fix(raw.pvs),
    pvsTable: { leafRow: raw.pvsTable.leafRow, rows: fix(raw.pvsTable.rows) },
  };
}
