/**
 * The compiler pipeline: level → walls → BSP → portals → vis → PVS.
 *
 * Each stage is a pure function in its own module; this file only wires them
 * together, records timings, and gathers statistics. {@link createCompiler}
 * binds the pipeline to one dimension: the geometry kernel plus the two
 * stages that are geometry-specific (level → walls, portal discovery).
 */

import { type BspBuildOptions, type BspBuildResult, type BspStats, type BspCache, type BspTree, type LeafSurface, buildBsp, buildBspIncremental, buildLeafSurfaces } from "./bsp";
import { type DoorInfo, type DoorVolume, findDoors, splitLeavesByDoors } from "./doors";
import type { Dim, Geometry } from "./geometry";
import { type BoundaryPiece, type ClusterOptions, type LeakReport, type PortalGraph, buildLeafClusters, detectLeaks } from "./portals";
import { type BitSet, type PassageTable, type PortalFlowOptions, type PortalFlowResult, type PortalFlowStats, type PvsSymmetry, type PvsClusterOptions, type PvsClusters, type PvsTable, type BaseVisCache, type FlowCache, buildPvsClusters, computeBaseVisIncremental, portalKeyIds, buildPvsTable, computeBaseVis, computePortalFlowIncremental, computePassages, passageMightSee, computeLeafPvs, computePortalFlow, expandClusterRows } from "./vis";
import type { Wall } from "./wall";

export interface CompileOptions {
  readonly bsp: Partial<BspBuildOptions>;
  readonly flow: Partial<PortalFlowOptions>;
  readonly symmetry: PvsSymmetry;
  /**
   * Base vis estimate: `"planes"` (rules 1 + 2 and flood) or `"passages"` (phases 2a + 2b: planes,
   * then canSee rows of every portal pair (`computePassages`) tighten mightSee and prune the flow at
   * every depth). Both conservative.
   */
  readonly baseVis: BaseVisMode;
  /**
   * Phase 3e: run base vis, passages and flow on portal-convex leaf clusters (`buildLeafClusters`)
   * instead of leaves. Fewer, larger units: faster, conservative, rows only grow. `"none"`: off.
   */
  readonly cluster: ClusterMode;
  readonly clusterOptions: Partial<ClusterOptions>;
  /**
   * Phase 3b: group leaves into PVS clusters after the flow (`buildPvsClusters`): `pvs` stays per
   * leaf, `CompileResult.pvsClusters` gets a coarser, conservative cluster PVS. `"none"`: off.
   */
  readonly pvsCluster: PvsClusterMode;
  readonly pvsClusterOptions: Partial<PvsClusterOptions>;
}

/** See {@link CompileOptions.pvsCluster}. */
export type PvsClusterMode = "none" | "wide";

/** See {@link CompileOptions.cluster}. */
export type ClusterMode = "none" | "convex";

/** Summary of the clusters a compile ran its vis on (see {@link CompileOptions.cluster}). */
export interface ClusterSummary {
  /** `leafCluster[leaf]` = cluster id. */
  readonly leafCluster: Int32Array;
  readonly count: number;
  /** Directed portals of the cluster graph (the flow's portals). */
  readonly portalCount: number;
}

/** See {@link CompileOptions.baseVis}. */
export type BaseVisMode = "planes" | "passages";

export const DEFAULT_COMPILE_OPTIONS: CompileOptions = Object.freeze({ bsp: {}, flow: {}, symmetry: "none", baseVis: "planes", cluster: "none", clusterOptions: {}, pvsCluster: "none", pvsClusterOptions: {} });

export interface StageTiming {
  readonly stage: string;
  readonly ms: number;
}

export interface VisSummary {
  readonly emptyLeafCount: number;
  /** Average number of leaves in an empty leaf's PVS. */
  readonly averageVisibleLeaves: number;
  /** Average fraction of empty leaves visible (1 = no culling at all). */
  readonly averageVisibleFraction: number;
  /** Average "might see" (base vis) set size per portal, for comparison with flow. */
  readonly averageMightSee: number;
  /** Average final portal vis set size. */
  readonly averagePortalVis: number;
}

export interface CompileResult<D extends Dim> {
  readonly walls: readonly Wall<D>[];
  /**
   * Faces of detail brushes from the full CSG (all brushes): trimmed by rooms and other solids,
   * drawn by a game but never given to the BSP. Empty for raw-wall compiles.
   */
  readonly detailWalls: readonly Wall<D>[];
  readonly tree: BspTree<D>;
  readonly bspStats: BspStats;
  /** `surfaces[leaf]` = wall pieces bounding each empty leaf. */
  readonly surfaces: readonly (readonly LeafSurface<D>[])[];
  readonly graph: PortalGraph<D>;
  readonly leaks: LeakReport;
  /**
   * Occluding doors (phase 4b), one per door name: their leaves, the portals they seal and whether
   * they seal at all. The PVS is baked with every door open; `doorPortalOpen` gives the runtime state.
   */
  readonly doors: readonly DoorInfo[];
  /** Clusters the vis ran on, or null (`cluster: "none"`). Rows below are always per leaf portal. */
  readonly clusters: ClusterSummary | null;
  /** Base vis: per portal. */
  readonly mightSee: readonly BitSet[];
  /** Flow result: per portal. */
  readonly portalVis: readonly BitSet[];
  readonly flowStats: PortalFlowStats;
  /** Final PVS: one row per BSP leaf, bits indexed by leaf. */
  readonly pvs: readonly BitSet[];
  /** The same PVS with identical rows shared: `pvs[leaf]` equals `pvsTable.rows[pvsTable.leafRow[leaf]]`. Used by the export. */
  readonly pvsTable: PvsTable;
  /** PVS clusters (`pvsCluster: "wide"`), or null. */
  readonly pvsClusters: PvsClusters | null;
  readonly summary: VisSummary;
  readonly timings: readonly StageTiming[];
}

/** The dimension-specific parts of a compiler. `L` is the level type. */
export interface CompilerConfig<D extends Dim, L> {
  readonly geometry: Geometry<D>;
  /** Complete BSP options used where the caller does not override them. */
  readonly bspDefaults: BspBuildOptions;
  /** Level → walls (CSG of the brushes, plus any raw geometry). */
  readonly levelWalls: (level: L) => Wall<D>[];
  /** Level → detail brush faces (full CSG); none if omitted. */
  readonly detailWalls?: (level: L) => Wall<D>[];
  /** Level → door volumes (non-structural door brushes); none if omitted. */
  readonly doorVolumes?: (level: L) => DoorVolume<D>[];
  /** Portal discovery between the empty leaves of a tree. */
  readonly buildPortalGraph: (tree: BspTree<D>) => PortalGraph<D>;
}

export interface Compiler<D extends Dim, L> {
  /** Compiles a level. */
  compileLevel(level: L, options?: Partial<CompileOptions>): CompileResult<D>;
  /**
   * Compiles raw walls (empty space in front of each wall). Use this entry
   * point for non-CSG input, which may leak. `timings` receives the stages.
   */
  compileWalls(walls: readonly Wall<D>[], options?: Partial<CompileOptions>, timings?: StageTiming[]): CompileResult<D>;
  /** Like `compileLevel`, but stages with a runner in `runners` are delegated to it (e.g. a worker pool). */
  compileLevelAsync(level: L, options: Partial<CompileOptions>, runners: StageRunners<D>): Promise<CompileResult<D>>;
  /** Starts an editing session whose compiles reuse the previous compile's flow rows where exact (phase 3.5). */
  session(): CompileSession<D, L>;
}

/** What a session compile took from the previous one: BSP nodes, and base vis rows / flow sources. */
export interface SessionReuse {
  /** BSP nodes copied from the previous tree (`buildBspIncremental`). */
  readonly bspNodes: number;
  readonly baseVis: number;
  readonly flow: number;
}

/** Stateful, single-threaded compiles that reuse flow rows across edits (`computePortalFlowIncremental`). */
export interface CompileSession<D extends Dim, L> {
  /** Like `Compiler.compileLevel`, plus how many base vis rows and flow sources came from the previous compile. */
  compileLevel(level: L, options?: Partial<CompileOptions>): { readonly result: CompileResult<D>; readonly reused: SessionReuse };
}

/** Runs the BSP stage with complete options; must return what `buildBsp` would. */
export type BspRunner<D extends Dim> = (walls: readonly Wall<D>[], options: BspBuildOptions) => Promise<BspBuildResult<D>>;

/** Runs the portal flow stage; must honour the options like `computePortalFlow`. */
export type FlowRunner<D extends Dim> = (graph: PortalGraph<D>, mightSee: readonly BitSet[], options: Partial<PortalFlowOptions>) => Promise<PortalFlowResult>;

/** Builds the passage table (`baseVis: "passages"`) from base vis rows; must return what `computePassages` would. */
export type PassageRunner<D extends Dim> = (graph: PortalGraph<D>, mightSee: readonly BitSet[]) => Promise<PassageTable>;

/** Computes base vis rows; must return what `computeBaseVis` would. */
export type BaseVisRunner<D extends Dim> = (graph: PortalGraph<D>) => Promise<readonly BitSet[]>;

/** Delegated stages of `compileLevelAsync`: the flow always, the others only if given (else run here). */
export interface StageRunners<D extends Dim> {
  readonly flow: FlowRunner<D>;
  readonly bsp?: BspRunner<D>;
  readonly baseVis?: BaseVisRunner<D>;
  readonly passages?: PassageRunner<D>;
}

/** Binds the pipeline to one dimension. */
export function createCompiler<D extends Dim, L>(config: CompilerConfig<D, L>): Compiler<D, L> {
  const g = config.geometry;

  /**
   * Stages up to portals, leaks and doors; `bsp` is the BSP stage's result (built by the caller,
   * timed in `timings`). Door volumes first split the leaves they overlap (`splitLeavesByDoors`).
   */
  const throughPortals = (walls: readonly Wall<D>[], bsp: BspBuildResult<D>, opts: CompileOptions, timings: StageTiming[], doorVolumes: readonly DoorVolume<D>[] = []) => {
    const split = doorVolumes.length ? timed(timings, "door splits", () => splitLeavesByDoors(g, bsp.tree, doorVolumes)) : null;
    const tree = split ? split.tree : bsp.tree;
    const bspStats = split?.splitCount ? treeStats(tree, bsp.stats, split.splitCount) : bsp.stats;
    const surfaces = timed(timings, "surfaces", () => buildLeafSurfaces(g, tree, walls));
    const graph = timed(timings, "portals", () => config.buildPortalGraph(tree));
    const leaks = timed(timings, "leaks", () => detectLeaks(g, tree, graph));
    const doors = doorVolumes.length ? timed(timings, "doors", () => findDoors(g, tree, graph, doorVolumes)) : [];
    const vc = opts.cluster === "convex" ? timed(timings, "clusters", () => buildLeafClusters(g, tree, graph, clusterWalls(g, walls, surfaces), opts.clusterOptions)) : null;
    // `visGraph`: the graph base vis, passages and flow run on (clusters or leaves).
    return { walls, tree, bspStats, surfaces, graph, leaks, doors, vc, visGraph: vc ? vc.graph : graph };
  };

  /** Stages up to base vis, single-threaded. */
  const throughBaseVis = (walls: readonly Wall<D>[], bsp: BspBuildResult<D>, opts: CompileOptions, timings: StageTiming[], doors: readonly DoorVolume<D>[]) => {
    const pre = throughPortals(walls, bsp, opts, timings, doors);
    const base: readonly BitSet[] = timed(timings, "base vis", () => computeBaseVis(g, pre.visGraph));
    return { ...pre, base };
  };

  /** Adds the flow's mightSee (tightened when a passage table is given) to the base-vis stages. */
  const withPassages = (pre: ReturnType<typeof throughBaseVis>, passages: PassageTable | null, timings: StageTiming[]) => {
    const mightSee = passages ? timed(timings, "passage flood", () => passageMightSee(pre.visGraph, passages)) : pre.base;
    return { ...pre, mightSee, passages };
  };

  /** Stages up to the flow input, single-threaded. */
  const beforeFlow = (walls: readonly Wall<D>[], bsp: BspBuildResult<D>, opts: CompileOptions, timings: StageTiming[], doors: readonly DoorVolume<D>[]) => {
    const pre = throughBaseVis(walls, bsp, opts, timings, doors);
    const passages = opts.baseVis === "passages" ? timed(timings, "passage vis", () => computePassages(g, pre.visGraph, pre.base)) : null;
    return withPassages(pre, passages, timings);
  };

  /** Stages after portal flow, assembling the result. */
  const afterFlow = (pre: ReturnType<typeof beforeFlow>, flow: PortalFlowResult, opts: CompileOptions, timings: StageTiming[]): CompileResult<D> => {
    const { passages: _passages, base: _base, vc, visGraph: _visGraph, ...rest } = pre; // flow-only inputs stay out of the result (size, worker clone)
    const { tree, graph } = pre;
    const { stats: flowStats } = flow;
    // Cluster rows back to leaf portals, so everything below (and the result) is per leaf portal.
    const mightSee = vc ? expandClusterRows(graph, vc, pre.mightSee) : pre.mightSee;
    const portalVis = vc ? expandClusterRows(graph, vc, flow.portalVis) : flow.portalVis;
    const clusters = vc ? { leafCluster: vc.leafCluster, count: vc.count, portalCount: vc.graph.portals.length } : null;
    const pvs = timed(timings, "leaf pvs", () => computeLeafPvs(tree, graph, portalVis, opts.symmetry));
    const pvsTable = timed(timings, "pvs rows", () => buildPvsTable(pvs));
    const pvsClusters = opts.pvsCluster === "wide"
      ? timed(timings, "pvs clusters", () => buildPvsClusters(g, tree, graph, pre.surfaces.map((ss) => ss.map((s) => g.facetMeasure(s.winding))), pvs, opts.pvsClusterOptions))
      : null;
    return { ...rest, mightSee, clusters, detailWalls: [], portalVis, flowStats, pvs, pvsTable, pvsClusters, summary: summarize(tree, graph, mightSee, portalVis, pvs), timings };
  };

  const compileWalls = (walls: readonly Wall<D>[], options: Partial<CompileOptions> = {}, timings: StageTiming[] = []): CompileResult<D> =>
    compileWithDoors(walls, [], options, timings);

  /** `compileWalls` plus door volumes (see `throughPortals`). */
  const compileWithDoors = (walls: readonly Wall<D>[], doors: readonly DoorVolume<D>[], options: Partial<CompileOptions>, timings: StageTiming[]): CompileResult<D> => {
    const opts: CompileOptions = { ...DEFAULT_COMPILE_OPTIONS, ...options };
    const bsp = timed(timings, "bsp", () => buildBsp(g, walls, bspOptions(opts)));
    const pre = beforeFlow(walls, bsp, opts, timings, doors);
    const flow = timed(timings, "portal flow", () => computePortalFlow(g, pre.visGraph, pre.mightSee, flowOptions(opts, pre)));
    return afterFlow(pre, flow, opts, timings);
  };

  const compileLevel = (level: L, options: Partial<CompileOptions> = {}): CompileResult<D> => {
    const timings: StageTiming[] = [];
    const walls = timed(timings, "csg", () => config.levelWalls(level));
    const detailWalls = levelDetailWalls(level, timings);
    return { ...compileWithDoors(walls, levelDoors(level), options, timings), detailWalls };
  };

  /** Door volumes of a level (none when the dimension has no doors). */
  const levelDoors = (level: L): DoorVolume<D>[] => (config.doorVolumes ? config.doorVolumes(level) : []);

  /** Detail faces of a level, timed as "detail csg" when the dimension provides them. */
  const levelDetailWalls = (level: L, timings: StageTiming[]): Wall<D>[] =>
    config.detailWalls ? timed(timings, "detail csg", () => config.detailWalls!(level)) : [];

  const bspOptions = (opts: CompileOptions): BspBuildOptions => ({ ...config.bspDefaults, ...opts.bsp });

  const compileLevelAsync = async (level: L, options: Partial<CompileOptions>, runners: StageRunners<D>): Promise<CompileResult<D>> => {
    const opts: CompileOptions = { ...DEFAULT_COMPILE_OPTIONS, ...options };
    const timings: StageTiming[] = [];
    const walls = timed(timings, "csg", () => config.levelWalls(level));
    const detailWalls = levelDetailWalls(level, timings);
    const tb = performance.now();
    const bsp = runners.bsp ? await runners.bsp(walls, bspOptions(opts)) : buildBsp(g, walls, bspOptions(opts));
    timings.push({ stage: "bsp", ms: performance.now() - tb });
    const portals = throughPortals(walls, bsp, opts, timings, levelDoors(level));
    const tv = performance.now();
    const base = { ...portals, base: runners.baseVis ? await runners.baseVis(portals.visGraph) : computeBaseVis(g, portals.visGraph) };
    timings.push({ stage: "base vis", ms: performance.now() - tv });
    let passages: PassageTable | null = null;
    if (opts.baseVis === "passages") {
      const tp = performance.now();
      passages = runners.passages ? await runners.passages(base.visGraph, base.base) : computePassages(g, base.visGraph, base.base);
      timings.push({ stage: "passage vis", ms: performance.now() - tp });
    }
    const pre = withPassages(base, passages, timings);
    const t0 = performance.now();
    const flow = await runners.flow(pre.visGraph, pre.mightSee, flowOptions(opts, pre));
    timings.push({ stage: "portal flow", ms: performance.now() - t0 });
    return { ...afterFlow(pre, flow, opts, timings), detailWalls };
  };

  const session = (): CompileSession<D, L> => {
    let bspCache: BspCache<D> | null = null;
    let baseCache: BaseVisCache<D> | null = null;
    let flowCache: FlowCache<D> | null = null;
    return {
      compileLevel(level, options = {}) {
        const opts: CompileOptions = { ...DEFAULT_COMPILE_OPTIONS, ...options };
        const timings: StageTiming[] = [];
        const walls = timed(timings, "csg", () => config.levelWalls(level));
        const detailWalls = levelDetailWalls(level, timings);
        const inc = timed(timings, "bsp", () => buildBspIncremental(g, walls, bspOptions(opts), bspCache));
        bspCache = inc.cache;
        const bsp = inc.result;
        const portals = throughPortals(walls, bsp, opts, timings, levelDoors(level));
        const ids = timed(timings, "portal keys", () => portalKeyIds(g, portals.visGraph));
        const bv = timed(timings, "base vis", () => computeBaseVisIncremental(g, portals.visGraph, baseCache, ids));
        baseCache = bv.cache;
        const base = { ...portals, base: bv.rows as readonly BitSet[] };
        const passages = opts.baseVis === "passages" ? timed(timings, "passage vis", () => computePassages(g, base.visGraph, base.base)) : null;
        const pre = withPassages(base, passages, timings);
        const flow = timed(timings, "portal flow", () => computePortalFlowIncremental(g, pre.visGraph, pre.mightSee, flowOptions(opts, pre), flowCache, ids));
        flowCache = flow.cache;
        return { result: { ...afterFlow(pre, flow, opts, timings), detailWalls }, reused: { bspNodes: inc.reusedNodes, baseVis: bv.reused, flow: flow.reused } };
      },
    };
  };

  return { compileLevel, compileWalls, compileLevelAsync, session };
}

/** The flow options of a compile; with a passage table, also the table and the base-vis source order. */
function flowOptions(opts: CompileOptions, pre: { readonly passages: PassageTable | null; readonly base: readonly BitSet[] }): Partial<PortalFlowOptions> {
  return pre.passages ? { ...opts.flow, passages: pre.passages, orderBy: pre.base } : opts.flow;
}

/** BSP stats of a tree changed after the build (door splits): counts recomputed, `extraSplits` added to the refine splits. */
function treeStats<D extends Dim>(tree: BspTree<D>, base: BspStats, extraSplits: number): BspStats {
  const empty = tree.leaves.filter((l) => l.contents === "empty").length;
  return {
    ...base, nodeCount: tree.nodes.length, leafCount: tree.leaves.length, emptyLeafCount: empty, solidLeafCount: tree.leaves.length - empty,
    maxDepth: tree.leaves.reduce((m, l) => Math.max(m, l.depth), 0), refineSplitCount: base.refineSplitCount + extraSplits,
  };
}

/** Averages of the PVS and portal-vis set sizes, for the stats panel. */
function summarize<D extends Dim>(tree: BspTree<D>, graph: PortalGraph<D>, mightSee: readonly BitSet[], portalVis: readonly BitSet[], pvs: readonly BitSet[]): VisSummary {
  const empty = tree.leaves.map((l, i) => (l.contents === "empty" && l.region ? i : -1)).filter((i) => i >= 0);
  const visible = empty.reduce((s, i) => s + pvs[i].count(), 0);
  const avg = (rows: readonly BitSet[]) => (rows.length ? rows.reduce((s, r) => s + r.count(), 0) / rows.length : 0);
  return {
    emptyLeafCount: empty.length,
    averageVisibleLeaves: empty.length ? visible / empty.length : 0,
    averageVisibleFraction: empty.length ? visible / (empty.length * empty.length) : 0,
    averageMightSee: avg(mightSee),
    averagePortalVis: graph.portals.length ? avg(portalVis) : 0,
  };
}

/** Wall pieces bounding each leaf as cluster boundary pieces (plane flipped to face out of the leaf). */
function clusterWalls<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], surfaces: readonly (readonly LeafSurface<D>[])[]): BoundaryPiece<D>[][] {
  return surfaces.map((ss) => ss.map((s) => ({ plane: g.flipPlane(walls[s.wall].plane), winding: s.winding })));
}

/** Runs `fn`, appending its wall-clock time to `timings` under `stage`. */
function timed<T>(timings: StageTiming[], stage: string, fn: () => T): T {
  const t0 = performance.now();
  const result = fn();
  timings.push({ stage, ms: performance.now() - t0 });
  return result;
}
