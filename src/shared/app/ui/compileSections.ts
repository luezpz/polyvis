/**
 * Panel sections about compilation, identical in both editors: compiler
 * options, export buttons, stats + timings, and leaf / portal probe rows.
 * Dimension-specific rows (level counts, probe point) are passed in.
 */

import { type BaseVisMode, type BspBuildOptions, type ClusterMode, type ClusterOptions, type CompileOptions, type CompileResult, type Dim, type PortalFlowOptions, type PvsClusterMode, type PvsClusterOptions, type PvsSymmetry, DEFAULT_CLUSTER_OPTIONS, DEFAULT_PVS_CLUSTER_OPTIONS, DEFAULT_PORTAL_FLOW_OPTIONS } from "../../core";
import { PORTAL_KIND_NAMES, debugInfo } from "../render/debugInfo";
import { h } from "./dom";
import { checkbox, kv, numberField, selectField } from "./widgets";

/** Compiler option fields. `options()` reads the current options (they change after each edit); `bspDefaults` is the dimension's `DEFAULT_BSP_OPTIONS`. */
export function compilerOptionsSection(options: () => CompileOptions, setOptions: (patch: Partial<CompileOptions>) => void, bspDefaults: BspBuildOptions): HTMLElement {
  const opts = options();
  const bsp = (patch: Partial<BspBuildOptions>) => setOptions({ bsp: { ...options().bsp, ...patch } });
  const flow = (patch: Partial<PortalFlowOptions>) => setOptions({ flow: { ...options().flow, ...patch } });
  const cluster = (patch: Partial<ClusterOptions>) => setOptions({ clusterOptions: { ...options().clusterOptions, ...patch } });
  const flowOpt = { ...DEFAULT_PORTAL_FLOW_OPTIONS, ...opts.flow };
  const clusterOpt = { ...DEFAULT_CLUSTER_OPTIONS, ...opts.clusterOptions };
  const pvsCluster = (patch: Partial<PvsClusterOptions>) => setOptions({ pvsClusterOptions: { ...options().pvsClusterOptions, ...patch } });
  const pvsClusterOpt = { ...DEFAULT_PVS_CLUSTER_OPTIONS, ...opts.pvsClusterOptions };
  return h("div", { class: "stack" },
    numberField("BSP split weight", opts.bsp.splitWeight ?? bspDefaults.splitWeight, (v) => bsp({ splitWeight: v })),
    numberField("BSP balance weight", opts.bsp.balanceWeight ?? bspDefaults.balanceWeight, (v) => bsp({ balanceWeight: v })),
    numberField("BSP facing weight (0 = off)", opts.bsp.facingWeight ?? bspDefaults.facingWeight ?? 0, (v) => bsp({ facingWeight: v }),
      "Score bonus per wall lying on the splitter (phase 3f): fewer leaves and portals on most levels"),
    numberField("BSP max candidates per node (0 = all)", opts.bsp.maxCandidates ?? bspDefaults.maxCandidates ?? 0, (v) => bsp({ maxCandidates: Math.floor(v) }), undefined, 1),
    numberField("Bounds margin", opts.bsp.boundsMargin ?? bspDefaults.boundsMargin, (v) => bsp({ boundsMargin: v }),
      "Padding around the walls' bounding box that closes off leaf regions"),
    checkbox("Corner splits (extend walls into touching cells)", opts.bsp.cornerSplits ?? bspDefaults.cornerSplits, (v) => bsp({ cornerSplits: v })),
    numberField("Min cell size", opts.bsp.minCellSize ?? bspDefaults.minCellSize, (v) => bsp({ minCellSize: v }),
      "Refinement splits never create cells thinner than this (0 = no limit)"),
    numberField("Max cell size (0 = off)", opts.bsp.maxCellSize ?? bspDefaults.maxCellSize, (v) => bsp({ maxCellSize: v }),
      "Empty cells larger than this along any axis are halved"),
    selectField<BaseVisMode>("Base vis", ["planes", "passages"], opts.baseVis, (v) => setOptions({ baseVis: v }),
      "passages: tighter might-see and per-step flow pruning (phase 2); costs a table build"),
    selectField<ClusterMode>("Vis clusters", ["none", "convex"], opts.cluster, (v) => setOptions({ cluster: v }),
      "convex: run vis on merged convex leaf clusters (phase 3e). Faster flow, looser PVS"),
    checkbox("Clusters merge across refinement splits", clusterOpt.acrossRefinement, (v) => cluster({ acrossRefinement: v })),
    numberField("Max leaves per cluster (0 = no limit)", clusterOpt.maxLeaves, (v) => cluster({ maxLeaves: Math.floor(v) }), undefined, 1),
    checkbox("Clip source by reverse antipenumbra", flowOpt.clipSource, (v) => flow({ clipSource: v })),
    checkbox("Cache separators per frame (exact, faster)", flowOpt.cacheSeparators, (v) => flow({ cacheSeparators: v })),
    numberField("Flow step budget (0 = no limit)", flowOpt.maxSteps, (v) => flow({ maxSteps: Math.floor(v) }),
      "Past this many generator tests, remaining portals fall back to base vis (conservative)", 1_000_000),
    selectField<PvsSymmetry>("PVS symmetry", ["none", "intersect", "union"], opts.symmetry, (v) => setOptions({ symmetry: v })),
    selectField<PvsClusterMode>("PVS clusters", ["none", "wide"], opts.pvsCluster, (v) => setOptions({ pvsCluster: v }),
      "wide: group leaves joined by wide portals after the flow (phase 3b). Fewer PVS units, looser"),
    numberField("PVS cluster min portal width (× leaf section)", pvsClusterOpt.minWidth, (v) => pvsCluster({ minWidth: v })),
    checkbox("PVS clusters merge across refinement splits", pvsClusterOpt.refinement, (v) => pvsCluster({ refinement: v })),
    numberField("Max leaves per PVS cluster (0 = no limit)", pvsClusterOpt.maxLeaves, (v) => pvsCluster({ maxLeaves: Math.floor(v) }), undefined, 1),
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
    ...(r.clusters ? [kv("Vis clusters / flow portals", `${r.clusters.count} / ${r.clusters.portalCount}`)] : []),
    kv("Avg might-see → flow", `${r.summary.averageMightSee.toFixed(1)} → ${r.summary.averagePortalVis.toFixed(1)}`),
    kv("PVS rows (unique / leaves)", `${r.pvsTable.rows.length} / ${r.pvs.length}`),
    kv("PVS columns (groups / leaves)", `${r.pvsTable.columnRows[0]?.size ?? 0} / ${r.pvs.length}`),
    ...(r.pvsClusters ? [kv("PVS clusters (count / unique rows)", `${r.pvsClusters.count} / ${r.pvsClusters.table.rows.length}`)] : []),
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
    if (r.clusters) {
      const c = r.clusters.leafCluster[leaf];
      const members = [...r.clusters.leafCluster.keys()].filter((l) => r.clusters!.leafCluster[l] === c);
      rows.push(kv("Vis cluster", `C${c} (${members.length} leaves)`));
    }
  }
  const portal = portalId !== null ? r.graph.portals[portalId] : undefined;
  if (portalId !== null && portal) {
    rows.push(h("hr"));
    rows.push(kv("Portal", `#${portal.id}: L${portal.from} → L${portal.to}`));
    rows.push(kv("Separates", PORTAL_KIND_NAMES[debugInfo(r).portalKind[portalId]]));
    rows.push(kv("Might see (base vis)", String(r.mightSee[portalId].count())));
    rows.push(kv("Sees (portal flow)", String(r.portalVis[portalId].count())));
  }
  return rows;
}
