/**
 * Panel sections about compilation, identical in both editors: compiler
 * options, export buttons, stats + timings, and leaf / portal probe rows.
 * Dimension-specific rows (level counts, probe point) are passed in.
 */

import type { BspBuildOptions, CompileOptions, CompileResult, Dim, PvsSymmetry } from "../../core";
import { h } from "./dom";
import { checkbox, kv, numberField } from "./widgets";

/** Compiler option fields. `options()` reads the current options (they change after each edit); `bspDefaults` is the dimension's `DEFAULT_BSP_OPTIONS`. */
export function compilerOptionsSection(options: () => CompileOptions, setOptions: (patch: Partial<CompileOptions>) => void, bspDefaults: BspBuildOptions): HTMLElement {
  const opts = options();
  const bsp = (patch: Partial<BspBuildOptions>) => setOptions({ bsp: { ...options().bsp, ...patch } });
  const symmetry = h("select", { onchange: (e: Event) => setOptions({ symmetry: (e.target as HTMLSelectElement).value as PvsSymmetry }) },
    ...(["none", "intersect", "union"] as const).map((s) => h("option", { value: s, selected: opts.symmetry === s }, s)));
  return h("div", { class: "stack" },
    numberField("BSP split weight", opts.bsp.splitWeight ?? bspDefaults.splitWeight, (v) => bsp({ splitWeight: v })),
    numberField("BSP balance weight", opts.bsp.balanceWeight ?? bspDefaults.balanceWeight, (v) => bsp({ balanceWeight: v })),
    checkbox("Corner splits (extend walls into touching cells)", opts.bsp.cornerSplits ?? bspDefaults.cornerSplits, (v) => bsp({ cornerSplits: v })),
    numberField("Min cell size", opts.bsp.minCellSize ?? bspDefaults.minCellSize, (v) => bsp({ minCellSize: v }),
      "Refinement splits never create cells thinner than this (0 = no limit)"),
    numberField("Max cell size (0 = off)", opts.bsp.maxCellSize ?? bspDefaults.maxCellSize, (v) => bsp({ maxCellSize: v }),
      "Empty cells larger than this along any axis are halved"),
    checkbox("Clip source by reverse antipenumbra", opts.flow.clipSource ?? true, (v) => setOptions({ flow: { ...options().flow, clipSource: v } })),
    h("label", { class: "field" }, h("span", {}, "PVS symmetry"), symmetry),
  );
}

/** The two PVS export buttons. */
export function exportButtons(exportJson: () => void, exportText: () => void): HTMLElement {
  return h("div", { class: "button-row" },
    h("button", { class: "primary", onclick: exportJson }, "Export PVS (.json)"),
    h("button", { class: "primary", onclick: exportText }, "Export PVS (.txt)"),
  );
}

/**
 * Stats read-out rows. `r` is the latest result (may be stale while `compiling`),
 * `levelRows` the dimension's level counts shown first.
 */
export function statsRows<D extends Dim>(r: CompileResult<D> | null, error: string | null, compiling: boolean, levelRows: readonly HTMLElement[]): HTMLElement[] {
  const busy = compiling ? [h("div", { class: "muted" }, "Compiling…")] : [];
  if (error) return [h("div", { class: "error" }, `Compile error: ${error}`), ...busy];
  if (!r) return [h("span", { class: "muted" }, "Not compiled"), ...busy];
  const total = r.timings.reduce((s, t) => s + t.ms, 0);
  return [
    ...busy,
    ...levelRows,
    kv("Walls", String(r.walls.length)),
    kv("BSP nodes / depth", `${r.bspStats.nodeCount} / ${r.bspStats.maxDepth}`),
    kv("Leaves (empty / solid)", `${r.summary.emptyLeafCount} / ${r.bspStats.solidLeafCount}`),
    kv("Wall splits / refine splits", `${r.bspStats.splitCount} / ${r.bspStats.refineSplitCount}`),
    kv("Portals (directed)", String(r.graph.portals.length)),
    kv("Avg might-see → flow", `${r.summary.averageMightSee.toFixed(1)} → ${r.summary.averagePortalVis.toFixed(1)}`),
    kv("PVS rows (unique / leaves)", `${r.pvsTable.rows.length} / ${r.pvs.length}`),
    kv("Avg visible leaves", `${r.summary.averageVisibleLeaves.toFixed(1)} (${(r.summary.averageVisibleFraction * 100).toFixed(0)}%)`),
    kv("Flow steps", `${r.flowStats.steps}${r.flowStats.truncated ? " (TRUNCATED)" : ""}`),
    ...(r.leaks.leaking ? [h("div", { class: "error" }, `Leak: ${r.leaks.boundaryLeaves.length} empty leaves touch the bounds (${r.leaks.outsideLeaves.length} reachable)`)] : []),
    h("div", { class: "timings" },
      ...r.timings.map((t) => kv(t.stage, `${t.ms.toFixed(2)} ms`)),
      kv("total", `${total.toFixed(2)} ms`)),
  ];
}

/** Probe rows for leaf `leaf` (its contents, PVS and outgoing portals) and, if non-null, the hovered portal's vis counts. */
export function probeRows<D extends Dim>(r: CompileResult<D>, leaf: number, portalId: number | null): HTMLElement[] {
  const contents = r.tree.leaves[leaf].contents;
  const rows: HTMLElement[] = [kv("Leaf", `L${leaf} (${contents})`)];
  if (contents === "empty") {
    const vis = r.pvs[leaf].toArray();
    rows.push(kv("PVS", `${vis.length} / ${r.summary.emptyLeafCount} leaves`));
    rows.push(h("div", { class: "ids" }, vis.map((i) => `L${i}`).join(" ")));
    rows.push(kv("Portals out", r.graph.portalsFrom[leaf].map((i) => `${i}`).join(", ") || "—"));
  }
  const portal = portalId !== null ? r.graph.portals[portalId] : undefined;
  if (portalId !== null && portal) {
    rows.push(h("hr"));
    rows.push(kv("Portal", `#${portal.id}: L${portal.from} → L${portal.to}`));
    rows.push(kv("Might see (base vis)", String(r.mightSee[portalId].count())));
    rows.push(kv("Sees (portal flow)", String(r.portalVis[portalId].count())));
  }
  return rows;
}
