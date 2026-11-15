/**
 * Messages between an editor and its compile worker, generic over the
 * dimension `D` and level type `L`.
 *
 * Results cross the worker boundary by structured clone, which keeps plain
 * objects and typed arrays but drops class prototypes: {@link hydrateResult}
 * turns the cloned `{ size, words }` objects back into `BitSet`s.
 */

import { type CompileOptions, type CompileResult, type Dim, BitSet } from "../../core";

export interface CompileRequest<L> {
  readonly id: number;
  readonly level: L;
  readonly options: Partial<CompileOptions>;
}

export type CompileResponse<D extends Dim> =
  | { readonly id: number; readonly result: CompileResult<D>; readonly ms: number }
  | { readonly id: number; readonly error: string };

type ClonedBitSet = { readonly size: number; readonly words: Uint32Array };

const toBitSet = (b: ClonedBitSet): BitSet => new BitSet(b.size, b.words);

/** Restores class instances lost in a structured clone. Update it when a `CompileResult` gains a class field. */
export function hydrateResult<D extends Dim>(raw: CompileResult<D>): CompileResult<D> {
  const fix = (rows: readonly unknown[]) => rows.map((r) => toBitSet(r as ClonedBitSet));
  return {
    ...raw,
    mightSee: fix(raw.mightSee),
    portalVis: fix(raw.portalVis),
    pvs: fix(raw.pvs),
    pvsTable: { leafRow: raw.pvsTable.leafRow, rows: fix(raw.pvsTable.rows) },
  };
}
