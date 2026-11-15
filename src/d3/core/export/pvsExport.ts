/**
 * Serializes compiled BSP + portals + PVS for consumption by a game engine.
 *
 * Two equivalent encodings are provided:
 *
 * - **JSON** (`polyvis-pvs-3d`): self-describing, easy to load anywhere.
 * - **Text** (`.pvs.txt`): line-oriented, trivially parsed with `sscanf` /
 *   `StreamReader` without a JSON library. See {@link exportPvsText}.
 *
 * Runtime usage in an engine:
 *   1. Walk the BSP from the root with the camera position to find its leaf
 *      (front if `dot(n, p) - d >= 0`, else back; negative refs are leaves).
 *   2. Read that leaf's PVS row, `rows[leaf.pvs]`; draw only the surfaces /
 *      objects in visible leaves (each leaf lists the walls that bound it,
 *      Quake "marksurfaces"; dynamic objects are tested against the convex
 *      leaf cells).
 *
 * PVS rows are **shared**: identical rows are stored once and each leaf holds
 * an index into the row table (version 2; see `vis/pvsTable.ts`). Bit `j` of
 * a row set ⇔ leaf `j` is potentially visible. Hex, two characters per byte,
 * bit `j` in byte `j >> 3` at bit position `j & 7` (LSB first).
 */

import { decodePvsRow } from "../../../shared/core";
import type { CompileResult } from "../pipeline";
import { type Vec3, polyhedronAabb } from "../math";

export const PVS_FORMAT = "polyvis-pvs-3d";
export const PVS_VERSION = 2;

type P3 = [number, number, number];
const p3 = (v: Vec3): P3 => [round(v.x), round(v.y), round(v.z)];
const round = (x: number): number => Math.round(x * 1e6) / 1e6;

export interface PvsDocument {
  readonly format: typeof PVS_FORMAT;
  readonly version: typeof PVS_VERSION;
  readonly bounds: { readonly min: P3; readonly max: P3 };
  /** `[nx, ny, nz, d]`; front half-space is `nx*x + ny*y + nz*z - d >= 0`. */
  readonly planes: readonly [number, number, number, number][];
  /** `[plane, frontRef, backRef]`; refs `>= 0` are nodes, `< 0` are leaf `-ref - 1`. */
  readonly nodes: readonly [number, number, number][];
  readonly root: number;
  /** CSG walls: convex polygons, CCW seen from the empty side. */
  readonly walls: readonly { readonly points: readonly P3[] }[];
  readonly leaves: readonly {
    readonly contents: "empty" | "solid";
    /** Bounding box of the leaf cell, or null for degenerate leaves. */
    readonly bounds: { readonly min: P3; readonly max: P3 } | null;
    /** Index of this leaf's row in `pvs.rows`. */
    readonly pvs: number;
    /** Ids of portals leading out of this leaf. */
    readonly portals: readonly number[];
    /** Indices of walls with a piece bounding this leaf. */
    readonly walls: readonly number[];
  }[];
  /** Directed portals; `points` is CCW seen from `to`. */
  readonly portals: readonly { readonly from: number; readonly to: number; readonly points: readonly P3[] }[];
  /** Distinct PVS rows, each `ceil(leafCount / 8)` bytes. */
  readonly pvs: { readonly encoding: "hex-lsb"; readonly rows: readonly string[] };
}

export function buildPvsDocument(result: CompileResult): PvsDocument {
  const { tree, graph, pvsTable, surfaces } = result;
  return {
    format: PVS_FORMAT,
    version: PVS_VERSION,
    bounds: { min: p3(tree.bounds.min), max: p3(tree.bounds.max) },
    planes: tree.planes.map((p) => [round(p.n.x), round(p.n.y), round(p.n.z), round(p.d)]),
    nodes: tree.nodes.map((n) => [n.plane, n.front, n.back]),
    root: tree.root,
    walls: result.walls.map((w) => ({ points: w.winding.map(p3) })),
    leaves: tree.leaves.map((l, i) => {
      const box = l.region ? polyhedronAabb(l.region) : null;
      return {
        contents: l.contents,
        bounds: box ? { min: p3(box.min), max: p3(box.max) } : null,
        pvs: pvsTable.leafRow[i],
        portals: [...graph.portalsFrom[i]],
        walls: [...new Set(surfaces[i].map((s) => s.wall))].sort((a, b) => a - b),
      };
    }),
    portals: graph.portals.map((p) => ({ from: p.from, to: p.to, points: p.winding.map(p3) })),
    pvs: { encoding: "hex-lsb", rows: pvsTable.rows.map((r) => r.toHex()) },
  };
}

export const exportPvsJson = (result: CompileResult): string => JSON.stringify(buildPvsDocument(result));

/**
 * Line-oriented text format:
 *
 * ```
 * polyvis-pvs-3d 2
 * bounds <minx> <miny> <minz> <maxx> <maxy> <maxz>
 * planes <count>
 * <nx> <ny> <nz> <d>                                  (× count)
 * nodes <count> root <ref>
 * <plane> <front> <back>                              (× count)
 * walls <count>
 * <npoints> <x y z>...                                (× count)
 * leaves <count>
 * <empty|solid> <minx miny minz maxx maxy maxz | -> <pvsRow> <nwalls> <wall>...   (× count)
 * portals <count>
 * <from> <to> <npoints> <x y z>...                    (× count)
 * pvs <rowCount> hex-lsb
 * <hex row>                                           (× rowCount; "-" for an all-zero row)
 * ```
 *
 * `<pvsRow>` indexes the rows after the `pvs` header (0-based).
 */
export function exportPvsText(result: CompileResult): string {
  const doc = buildPvsDocument(result);
  const lines: string[] = [];
  lines.push(`${doc.format} ${doc.version}`);
  lines.push(`bounds ${doc.bounds.min.join(" ")} ${doc.bounds.max.join(" ")}`);
  lines.push(`planes ${doc.planes.length}`);
  for (const p of doc.planes) lines.push(p.join(" "));
  lines.push(`nodes ${doc.nodes.length} root ${doc.root}`);
  for (const n of doc.nodes) lines.push(n.join(" "));
  lines.push(`walls ${doc.walls.length}`);
  for (const w of doc.walls) lines.push([w.points.length, ...w.points.flat()].join(" "));
  lines.push(`leaves ${doc.leaves.length}`);
  for (const l of doc.leaves) {
    const box = l.bounds ? [...l.bounds.min, ...l.bounds.max].join(" ") : "-";
    lines.push([l.contents, box, l.pvs, l.walls.length, ...l.walls].join(" "));
  }
  lines.push(`portals ${doc.portals.length}`);
  for (const p of doc.portals) lines.push([p.from, p.to, p.points.length, ...p.points.flat()].join(" "));
  lines.push(`pvs ${doc.pvs.rows.length} ${doc.pvs.encoding}`);
  for (const r of doc.pvs.rows) lines.push(/^0*$/.test(r) ? "-" : r);
  return lines.join("\n") + "\n";
}

/** Visible leaf indices from `leaf`, following the shared-row indirection of an exported document. */
export const decodeLeafPvs = (doc: PvsDocument, leaf: number): number[] => decodePvsRow(doc.pvs.rows[doc.leaves[leaf].pvs]);

export { decodePvsRow };
