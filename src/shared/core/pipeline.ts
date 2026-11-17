/**
 * The compiler pipeline: level → walls → BSP → portals → vis → PVS.
 *
 * Each stage is a pure function in its own module; this file only wires them
 * together, records timings, and gathers statistics. {@link createCompiler}
 * binds the pipeline to one dimension: the geometry kernel plus the two
 * stages that are geometry-specific (level → walls, portal discovery).
 */

import { type BspBuildOptions, type BspBuildResult, type BspStats, type BspTree, type LeafSurface, buildBsp, buildLeafSurfaces } from "./bsp";
import type { Dim, Geometry } from "./geometry";
import { type LeakReport, type PortalGraph, detectLeaks } from "./portals";
import { type BitSet, type PortalFlowOptions, type PortalFlowResult, type PortalFlowStats, type PvsSymmetry, type PvsTable, buildPvsTable, computeBaseVis, computeLeafPvs, computePortalFlow } from "./vis";
import type { Wall } from "./wall";

export interface CompileOptions {
  readonly bsp: Partial<BspBuildOptions>;
  readonly flow: Partial<PortalFlowOptions>;
  readonly symmetry: PvsSymmetry;
}

export const DEFAULT_COMPILE_OPTIONS: CompileOptions = Object.freeze({ bsp: {}, flow: {}, symmetry: "none" });

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
  /** Base vis: per portal. */
  readonly mightSee: readonly BitSet[];
  /** Flow result: per portal. */
  readonly portalVis: readonly BitSet[];
  readonly flowStats: PortalFlowStats;
  /** Final PVS: one row per BSP leaf, bits indexed by leaf. */
  readonly pvs: readonly BitSet[];
  /** The same PVS with identical rows shared: `pvs[leaf]` equals `pvsTable.rows[pvsTable.leafRow[leaf]]`. Used by the export. */
  readonly pvsTable: PvsTable;
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
  /** Like `compileLevel`, but the portal flow is delegated to `runFlow` and, if given, the BSP build to `runBsp` (e.g. a worker pool). */
  compileLevelAsync(level: L, options: Partial<CompileOptions>, runFlow: FlowRunner<D>, runBsp?: BspRunner<D>): Promise<CompileResult<D>>;
}

/** Runs the BSP stage with complete options; must return what `buildBsp` would. */
export type BspRunner<D extends Dim> = (walls: readonly Wall<D>[], options: BspBuildOptions) => Promise<BspBuildResult<D>>;

/** Runs the portal flow stage; must honour the options like `computePortalFlow`. */
export type FlowRunner<D extends Dim> = (graph: PortalGraph<D>, mightSee: readonly BitSet[], options: Partial<PortalFlowOptions>) => Promise<PortalFlowResult>;

/** Binds the pipeline to one dimension. */
export function createCompiler<D extends Dim, L>(config: CompilerConfig<D, L>): Compiler<D, L> {
  const g = config.geometry;

  /** Stages up to base vis; `bsp` is the BSP stage's result (built by the caller, timed in `timings`). */
  const beforeFlow = (walls: readonly Wall<D>[], bsp: BspBuildResult<D>, timings: StageTiming[]) => {
    const { tree, stats: bspStats } = bsp;
    const surfaces = timed(timings, "surfaces", () => buildLeafSurfaces(g, tree, walls));
    const graph = timed(timings, "portals", () => config.buildPortalGraph(tree));
    const leaks = timed(timings, "leaks", () => detectLeaks(g, tree, graph));
    const mightSee = timed(timings, "base vis", () => computeBaseVis(g, graph));
    return { walls, tree, bspStats, surfaces, graph, leaks, mightSee };
  };

  /** Stages after portal flow, assembling the result. */
  const afterFlow = (pre: ReturnType<typeof beforeFlow>, flow: PortalFlowResult, opts: CompileOptions, timings: StageTiming[]): CompileResult<D> => {
    const { tree, graph, mightSee } = pre;
    const { portalVis, stats: flowStats } = flow;
    const pvs = timed(timings, "leaf pvs", () => computeLeafPvs(tree, graph, portalVis, opts.symmetry));
    const pvsTable = timed(timings, "pvs rows", () => buildPvsTable(pvs));
    return { ...pre, detailWalls: [], portalVis, flowStats, pvs, pvsTable, summary: summarize(tree, graph, mightSee, portalVis, pvs), timings };
  };

  const compileWalls = (walls: readonly Wall<D>[], options: Partial<CompileOptions> = {}, timings: StageTiming[] = []): CompileResult<D> => {
    const opts: CompileOptions = { ...DEFAULT_COMPILE_OPTIONS, ...options };
    const bsp = timed(timings, "bsp", () => buildBsp(g, walls, bspOptions(opts)));
    const pre = beforeFlow(walls, bsp, timings);
    const flow = timed(timings, "portal flow", () => computePortalFlow(g, pre.graph, pre.mightSee, opts.flow));
    return afterFlow(pre, flow, opts, timings);
  };

  const compileLevel = (level: L, options: Partial<CompileOptions> = {}): CompileResult<D> => {
    const timings: StageTiming[] = [];
    const walls = timed(timings, "csg", () => config.levelWalls(level));
    const detailWalls = levelDetailWalls(level, timings);
    return { ...compileWalls(walls, options, timings), detailWalls };
  };

  /** Detail faces of a level, timed as "detail csg" when the dimension provides them. */
  const levelDetailWalls = (level: L, timings: StageTiming[]): Wall<D>[] =>
    config.detailWalls ? timed(timings, "detail csg", () => config.detailWalls!(level)) : [];

  const bspOptions = (opts: CompileOptions): BspBuildOptions => ({ ...config.bspDefaults, ...opts.bsp });

  const compileLevelAsync = async (level: L, options: Partial<CompileOptions>, runFlow: FlowRunner<D>, runBsp?: BspRunner<D>): Promise<CompileResult<D>> => {
    const opts: CompileOptions = { ...DEFAULT_COMPILE_OPTIONS, ...options };
    const timings: StageTiming[] = [];
    const walls = timed(timings, "csg", () => config.levelWalls(level));
    const detailWalls = levelDetailWalls(level, timings);
    const tb = performance.now();
    const bsp = runBsp ? await runBsp(walls, bspOptions(opts)) : buildBsp(g, walls, bspOptions(opts));
    timings.push({ stage: "bsp", ms: performance.now() - tb });
    const pre = beforeFlow(walls, bsp, timings);
    const t0 = performance.now();
    const flow = await runFlow(pre.graph, pre.mightSee, opts.flow);
    timings.push({ stage: "portal flow", ms: performance.now() - t0 });
    return { ...afterFlow(pre, flow, opts, timings), detailWalls };
  };

  return { compileLevel, compileWalls, compileLevelAsync };
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

/** Runs `fn`, appending its wall-clock time to `timings` under `stage`. */
function timed<T>(timings: StageTiming[], stage: string, fn: () => T): T {
  const t0 = performance.now();
  const result = fn();
  timings.push({ stage, ms: performance.now() - t0 });
  return result;
}
