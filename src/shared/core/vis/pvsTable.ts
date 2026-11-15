/**
 * PVS row sharing: removes duplicate rows from the leaf PVS.
 *
 * Many leaves end up with identical PVS rows (all solid leaves share the
 * empty row; neighbouring empty cells often see exactly the same set). The
 * table stores each distinct row once and gives every leaf an index into it:
 *
 *   PVS(leaf) = rows[leafRow[leaf]]
 *
 * This is pure indirection: bits still mean "leaf j is visible", leaves stay
 * the convex BSP cells, and decoding gives back the original PVS bit for bit.
 */

import { BitSet } from "./bitset";

export interface PvsTable {
  /** `leafRow[leaf]` = index into {@link PvsTable.rows}. */
  readonly leafRow: readonly number[];
  /** Distinct PVS rows, in order of first use; bit `j` set ⇔ leaf `j` potentially visible. */
  readonly rows: readonly BitSet[];
}

/** Builds the shared-row table for one PVS row per leaf. */
export function buildPvsTable(pvs: readonly BitSet[]): PvsTable {
  const index = new Map<string, number>();
  const rows: BitSet[] = [];
  const leafRow = pvs.map((row) => {
    const key = row.toHex();
    let i = index.get(key);
    if (i === undefined) {
      i = rows.length;
      index.set(key, i);
      rows.push(row);
    }
    return i;
  });
  return { leafRow, rows };
}

/** The PVS row of `leaf` (the shared row object; do not mutate). */
export const pvsRowOf = (table: PvsTable, leaf: number): BitSet => table.rows[table.leafRow[leaf]];
