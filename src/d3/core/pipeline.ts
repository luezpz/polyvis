/**
 * The 3D compiler: the shared pipeline (`shared/core/pipeline.ts`) bound to
 * the 3D geometry, CSG, mesh walls and portal discovery. The UI (via a
 * worker) and the tests both go through here.
 */

import * as shared from "../../shared/core";
import { DEFAULT_BSP_OPTIONS } from "./bsp";
import { type Wall, buildDetailWalls, buildWalls, buildMeshWalls } from "./csg";
import { type Dim3, geometry3 } from "./geometry";
import { type Level, isStructural } from "./level";
import { buildPortalGraph } from "./portals";

export { type CompileOptions, type StageTiming, type VisSummary, DEFAULT_COMPILE_OPTIONS } from "../../shared/core";

export type CompileResult = shared.CompileResult<Dim3>;

const compiler = shared.createCompiler<Dim3, Level>({
  geometry: geometry3,
  bspDefaults: DEFAULT_BSP_OPTIONS,
  levelWalls: (level) => [...buildWalls(level.brushes.filter(isStructural)), ...buildMeshWalls(level.meshes)],
  detailWalls: (level) => buildDetailWalls(level.brushes),
  buildPortalGraph,
});

/** Compiles a level: CSG of its brushes plus its imported meshes as raw walls. */
export const compileLevel = (level: Level, options: Partial<shared.CompileOptions> = {}): CompileResult => compiler.compileLevel(level, options);

/**
 * Compiles raw walls (empty space in front of each wall). Use this entry point
 * for non-CSG input such as imported meshes, which may leak.
 */
export const compileWalls = (walls: readonly Wall[], options: Partial<shared.CompileOptions> = {}, timings: shared.StageTiming[] = []): CompileResult =>
  compiler.compileWalls(walls, options, timings);

/** Like `compileLevel`, but the portal flow runs through `runFlow` and, if given, the BSP build through `runBsp` (the editor's worker pool). */
export const compileLevelAsync = (level: Level, options: Partial<shared.CompileOptions>, runFlow: shared.FlowRunner<Dim3>, runBsp?: shared.BspRunner<Dim3>): Promise<CompileResult> =>
  compiler.compileLevelAsync(level, options, runFlow, runBsp);
