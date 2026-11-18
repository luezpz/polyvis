/**
 * The 2D compiler: the shared pipeline (`shared/core/pipeline.ts`) bound to
 * the 2D geometry, CSG and portal discovery. The UI and the tests both go
 * through here.
 */

import * as shared from "../../shared/core";
import { DEFAULT_BSP_OPTIONS } from "./bsp";
import { type Wall, buildDetailWalls, buildWalls } from "./csg";
import { type Dim2, geometry2 } from "./geometry";
import { type Level, isStructural } from "./level";
import { buildPortalGraph } from "./portals";

export { type CompileOptions, type StageTiming, type VisSummary, DEFAULT_COMPILE_OPTIONS } from "../../shared/core";

export type CompileResult = shared.CompileResult<Dim2>;

const compiler = shared.createCompiler<Dim2, Level>({
  geometry: geometry2,
  bspDefaults: DEFAULT_BSP_OPTIONS,
  levelWalls: (level) => buildWalls(level.brushes.filter(isStructural)), // detail brushes never cut the BSP
  detailWalls: (level) => buildDetailWalls(level.brushes),
  buildPortalGraph,
});

/** Compiles a brush level. */
export const compileLevel = (level: Level, options: Partial<shared.CompileOptions> = {}): CompileResult => compiler.compileLevel(level, options);

/**
 * Compiles raw walls (empty space on each wall's left). Use this entry point
 * for non-CSG input, which may leak.
 */
export const compileWalls = (walls: readonly Wall[], options: Partial<shared.CompileOptions> = {}, timings: shared.StageTiming[] = []): CompileResult =>
  compiler.compileWalls(walls, options, timings);

/** Like `compileLevel`, but stages with a runner in `runners` are delegated to it (the editor's worker pool). */
export const compileLevelAsync = (level: Level, options: Partial<shared.CompileOptions>, runners: shared.StageRunners<Dim2>): Promise<CompileResult> =>
  compiler.compileLevelAsync(level, options, runners);
