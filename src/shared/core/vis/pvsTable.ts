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
 *
 * Column sharing (optimization plan 3c) applies the same idea to columns:
 * the column of leaf j is the set of distinct rows that contain bit j. Leaves
 * with identical columns (every solid leaf; cells that are always seen
 * together) share one column group, so the narrow rows need one bit per group:
 *
 *   PVS(a) has b  ⇔  columnRows[leafRow[a]].has(leafColumn[b])
 *
 * Also lossless: the narrow table decodes to the original PVS bit for bit.
 */

import { BitSet } from "./bitset";

export interface PvsTable {
  /** `leafRow[leaf]` = index into {@link PvsTable.rows}. */
  readonly leafRow: readonly number[];
  /** Distinct PVS rows, in order of first use; bit `j` set ⇔ leaf `j` potentially visible. */
  readonly rows: readonly BitSet[];
  /** `leafColumn[leaf]` = column group of `leaf` (leaves with identical columns share one). */
  readonly leafColumn: readonly number[];
  /** `columnRows[r]` = `rows[r]` narrowed to one bit per column group (`size` = group count). */
  readonly columnRows: readonly BitSet[];
}

/** Builds the shared-row + shared-column table for one PVS row per leaf (all rows of equal size). */
export function buildPvsTable(pvs: readonly BitSet[]): PvsTable {
  const { ids: leafRow, firsts: rows } = dedup(pvs, (row) => row.toHex());
  const { leafColumn, columnRows } = shareColumns(rows, pvs.length);
  return { leafRow, rows, leafColumn, columnRows };
}

/**
 * Groups leaves `0..leaves-1` by their column in `rows` and narrows the rows to one bit per group.
 * Cost O(rows × leaves) bits, the same as the table itself.
 */
function shareColumns(rows: readonly BitSet[], leaves: number): { leafColumn: number[]; columnRows: BitSet[] } {
  // Transpose: columns[j] bit r ⇔ rows[r] has j.
  const columns = Array.from({ length: leaves }, () => new BitSet(rows.length));
  rows.forEach((row, r) => {
    for (let j = 0; j < leaves; j++) if (row.has(j)) columns[j].set(r);
  });
  const { ids: leafColumn, firsts: groups } = dedup(columns, (c) => c.toHex());
  const columnRows = rows.map(() => new BitSet(groups.length));
  groups.forEach((col, g) => {
    for (let r = 0; r < rows.length; r++) if (col.has(r)) columnRows[r].set(g);
  });
  return { leafColumn, columnRows };
}

/** Maps each item to the index of the first item with the same key; `firsts` = those items in order. */
function dedup<T>(items: readonly T[], key: (t: T) => string): { ids: number[]; firsts: T[] } {
  const index = new Map<string, number>();
  const firsts: T[] = [];
  const ids = items.map((t) => {
    const k = key(t);
    let i = index.get(k);
    if (i === undefined) {
      i = firsts.length;
      index.set(k, i);
      firsts.push(t);
    }
    return i;
  });
  return { ids, firsts };
}

/** The PVS row of `leaf` (the shared row object; do not mutate). */
export const pvsRowOf = (table: PvsTable, leaf: number): BitSet => table.rows[table.leafRow[leaf]];

/** Decodes "leaf `to` potentially visible from leaf `from`" from the column-shared rows. */
export const pvsTableSees = (table: PvsTable, from: number, to: number): boolean =>
  table.columnRows[table.leafRow[from]].has(table.leafColumn[to]);
