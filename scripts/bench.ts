/**
 * Compile benchmark (docs/OPTIMIZATION-PLAN.md, phase 0): compiles the demo levels of both
 * dimensions single-threaded and prints one Markdown table row per level with the vis
 * stages' times and counters. Run with `npm run bench`; see `bench.mjs` for flags.
 */

import * as d2 from "../src/d2/core";
import * as d3 from "../src/d3/core";
import { type Dim2, geometry2 } from "../src/d2/core/geometry";
import { type Dim3, geometry3 } from "../src/d3/core/geometry";
import { type BitSet, type CompileOptions, type CompileResult, type Dim, type Geometry, type BaseVisRunner, type BaseVisWorker, type PassageRunner, type PassageWorker, computeBaseVisParallel, computePassagesParallel, computePortalFlow } from "../src/shared/core";

/** One bench thread (see `bench.mjs`): sends a request, resolves with its response. */
export type ThreadCall = (req: object) => Promise<{ words?: Uint32Array }>;

/** Levels slower than this many seconds are skipped unless `--all` (3D Oblique lattice ~110 s). */
const SLOW = new Set(["3d/Oblique lattice"]);

interface Case {
  readonly name: string;
  /** Demo group; edge cases are tiny and skipped unless `--all`. */
  readonly group?: string;
  readonly compile: () => Promise<CompileResult<Dim>>;
}

/** Sum of the set sizes of `rows`. */
const total = (rows: readonly BitSet[]): number => rows.reduce((s, r) => s + r.count(), 0);

/** Wall-clock ms of `stage` in a result's timings (0 if absent). */
const ms = (r: CompileResult<Dim>, stage: string): number => r.timings.find((t) => t.stage === stage)?.ms ?? 0;

/** `threads` as {@link PassageWorker}s for dimension `dim`. */
function threadWorkers(threads: readonly ThreadCall[], dim: 2 | 3): PassageWorker[] {
  return threads.map((call) => ({
    async begin(graph, mightSee) { await call({ type: "passage-begin", dim, graph, mightSee }); },
    async rows(p0, p1) { return (await call({ type: "passage-rows", p0, p1 })).words!; },
  }));
}

/** `threads` as {@link BaseVisWorker}s for dimension `dim`. */
function baseVisWorkers(threads: readonly ThreadCall[], dim: 2 | 3): BaseVisWorker[] {
  return threads.map((call) => ({
    async begin(graph) { await call({ type: "basevis-begin", dim, graph }); },
    async rows(p0, p1) { return (await call({ type: "basevis-rows", p0, p1 })).words!; },
  }));
}

/** Single-threaded flow as a `FlowRunner` (the bench times the passage build, not the parallel flow). */
const flowRunner = <D extends Dim>(g: Geometry<D>) => async (...a: Parameters<typeof computePortalFlow<D>> extends [unknown, ...infer R] ? R : never) => computePortalFlow(g, ...a);

/**
 * Bench cases: every demo of both dimensions, plus an optional OBJ (`obj`: path and file text).
 * `threads` (non-null): base vis and passage tables are built on them through `compileLevelAsync`.
 */
function cases(obj: { path: string; text: string } | null, opts: Partial<CompileOptions>, threads: readonly ThreadCall[] | null): Case[] {
  const run2: PassageRunner<Dim2> | undefined = threads ? (g, m) => computePassagesParallel(geometry2, g, m, threadWorkers(threads, 2)) : undefined;
  const run3: PassageRunner<Dim3> | undefined = threads ? (g, m) => computePassagesParallel(geometry3, g, m, threadWorkers(threads, 3)) : undefined;
  const base2: BaseVisRunner<Dim2> | undefined = threads ? (g) => computeBaseVisParallel(geometry2, g, baseVisWorkers(threads, 2)) : undefined;
  const base3: BaseVisRunner<Dim3> | undefined = threads ? (g) => computeBaseVisParallel(geometry3, g, baseVisWorkers(threads, 3)) : undefined;
  const c2 = async (level: d2.Level) => (run2 ? d2.compileLevelAsync(level, opts, flowRunner(geometry2), undefined, run2, base2) : d2.compileLevel(level, opts)) as Promise<CompileResult<Dim>>;
  const c3 = async (level: d3.Level) => (run3 ? d3.compileLevelAsync(level, opts, flowRunner(geometry3), undefined, run3, base3) : d3.compileLevel(level, opts)) as Promise<CompileResult<Dim>>;
  const out: Case[] = [
    ...d2.DEMO_LEVELS.map((s) => ({ name: `2d/${s.name}`, group: s.group, compile: () => c2(s.create()) })),
    ...d3.DEMO_LEVELS.map((s) => ({ name: `3d/${s.name}`, group: s.group, compile: () => c3(s.create()) })),
  ];
  if (obj) {
    const { faces } = d3.importObj(obj.text);
    const level: d3.Level = { format: d3.LEVEL_FORMAT, version: d3.LEVEL_VERSION, brushes: [], meshes: [{ id: 1, name: "obj", faces }] };
    out.push({ name: `3d/obj ${obj.path}`, compile: () => c3(level) });
  }
  return out;
}

/**
 * Entry point. `args`: `--all` (include slow and edge-case levels), `--only <substring>`, `--obj <path>`,
 * `--passages` (phase 2a/2b; "passage ms" = table build + flood), `--threads <n>` (handled by the launcher),
 * `--repeat <k>` (compile each level k times, report the last: warm JIT in the main thread and threads).
 * `readText(path)` reads the OBJ (passed in by the Node launcher; core code has no file access).
 * `threads`: bench threads for base vis and the passage build, or null (single-threaded).
 */
export async function main(args: readonly string[], readText: (path: string) => string, threads: readonly ThreadCall[] | null = null): Promise<void> {
  const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const all = args.includes("--all");
  const only = flag("--only");
  const repeat = Math.max(1, Number(flag("--repeat") ?? 1));
  const opts: Partial<CompileOptions> = args.includes("--passages") ? { baseVis: "passages" } : {};
  const header = ["level", "portals", "base vis ms", "passage ms", "Σ mightSee", "flow ms", "steps", "facet clips", "separator clips", "Σ portalVis", "Σ pvs"];
  console.log(`| ${header.join(" | ")} |\n|${header.map(() => "---").join("|")}|`);
  const objPath = flag("--obj");
  for (const c of cases(objPath ? { path: objPath, text: readText(objPath) } : null, opts, threads)) {
    if (only && !c.name.includes(only)) continue;
    if (!all && (SLOW.has(c.name) || c.group?.startsWith("Edge"))) continue;
    let r = await c.compile();
    for (let k = 1; k < repeat; k++) r = await c.compile();
    const f = r.flowStats;
    const row = [c.name, r.graph.portals.length, ms(r, "base vis").toFixed(0), (ms(r, "passage vis") + ms(r, "passage flood")).toFixed(0), total(r.mightSee), ms(r, "portal flow").toFixed(0),
      f.steps + (f.truncated ? " (trunc)" : ""), f.facetClips, f.separatorClips, total(r.portalVis), total(r.pvs)];
    console.log(`| ${row.join(" | ")} |`);
  }
}
