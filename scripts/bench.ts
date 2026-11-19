/**
 * Compile benchmark (docs/OPTIMIZATION-PLAN.md, phase 0): compiles the demo levels of both
 * dimensions single-threaded and prints one Markdown table row per level with the vis
 * stages' times and counters. Run with `npm run bench`; see `bench.mjs` for flags.
 */

import * as d2 from "../src/d2/core";
import * as d3 from "../src/d3/core";
import { geometry2 } from "../src/d2/core/geometry";
import { geometry3 } from "../src/d3/core/geometry";
import { type BitSet, type CompileOptions, type CompileResult, type Dim, type Geometry, type RowWorker, type StageRunners, computeBaseVisParallel, computePassagesParallel, computePortalFlow } from "../src/shared/core";

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

/** `threads` as {@link RowWorker}s for dimension `dim`. */
function rowWorkers(threads: readonly ThreadCall[], dim: 2 | 3): RowWorker[] {
  return threads.map((call) => ({
    async begin(job, graph, mightSee) { await call({ type: "rows-begin", dim, job, graph, mightSee }); },
    async rows(p0, p1) { return (await call({ type: "rows", p0, p1 })).words!; },
  }));
}

/** Single-threaded flow as a `FlowRunner` (the bench times the row stages, not the parallel flow). */
const flowRunner = <D extends Dim>(g: Geometry<D>) => async (...a: Parameters<typeof computePortalFlow<D>> extends [unknown, ...infer R] ? R : never) => computePortalFlow(g, ...a);

/** Runners of one dimension: single-threaded flow; base vis and passage table on `threads`. */
function threadRunners<D extends Dim>(g: Geometry<D>, threads: readonly ThreadCall[]): StageRunners<D> {
  const workers = rowWorkers(threads, g.dimension as 2 | 3);
  return {
    flow: flowRunner(g),
    baseVis: (graph) => computeBaseVisParallel(g, graph, workers),
    passages: (graph, mightSee) => computePassagesParallel(g, graph, mightSee, workers),
  };
}

/**
 * Bench cases: every demo of both dimensions, plus an optional OBJ (`obj`: path and file text).
 * `threads` (non-null): base vis and passage tables are built on them through `compileLevelAsync`.
 */
function cases(obj: { path: string; text: string } | null, opts: Partial<CompileOptions>, threads: readonly ThreadCall[] | null): Case[] {
  const r2 = threads && threadRunners(geometry2, threads), r3 = threads && threadRunners(geometry3, threads);
  const c2 = async (level: d2.Level) => (r2 ? d2.compileLevelAsync(level, opts, r2) : d2.compileLevel(level, opts)) as Promise<CompileResult<Dim>>;
  const c3 = async (level: d3.Level) => (r3 ? d3.compileLevelAsync(level, opts, r3) : d3.compileLevel(level, opts)) as Promise<CompileResult<Dim>>;
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

/** Phase 3b columns: cluster count, distinct cluster rows, Σ over empty leaves of leaves in visible clusters (comparable to Σ pvs). */
function clusterCols(r: CompileResult<Dim>): number[] {
  const c = r.pvsClusters!;
  const size = new Array<number>(c.count).fill(0);
  c.leafCluster.forEach((k, l) => { if (r.tree.leaves[l].contents === "empty") size[k]++; });
  let sum = 0;
  r.tree.leaves.forEach((l, i) => { if (l.contents === "empty") for (const k of c.pvs[c.leafCluster[i]].toArray()) sum += size[k]; });
  return [c.count, c.table.rows.length, sum];
}

/**
 * Entry point. `args`: `--all` (include slow and edge-case levels), `--only <substring>`, `--obj <path>`,
 * `--passages` (phase 2a/2b; "passage ms" = table build + flood), `--cluster` (phase 3e), `--pvs-cluster [json options]` (phase 3b, e.g. `{"minWidth":0.9}`; adds cluster count, cluster table rows, Σ cluster pvs in leaves), `--bsp <json>` (BSP options, e.g. phase 3f `{"facingWeight":4}`),`--threads <n>` (handled by the launcher),
 * `--repeat <k>` (compile each level k times, report the last: warm JIT in the main thread and threads).
 * `readText(path)` reads the OBJ (passed in by the Node launcher; core code has no file access).
 * `threads`: bench threads for base vis and the passage build, or null (single-threaded).
 */
export async function main(args: readonly string[], readText: (path: string) => string, threads: readonly ThreadCall[] | null = null): Promise<void> {
  const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const all = args.includes("--all");
  const only = flag("--only");
  const repeat = Math.max(1, Number(flag("--repeat") ?? 1));
  const opts: Partial<CompileOptions> = { ...(args.includes("--passages") ? { baseVis: "passages" } : {}), ...(args.includes("--cluster") ? { cluster: "convex" } : {}), ...(args.includes("--pvs-cluster") ? { pvsCluster: "wide", pvsClusterOptions: flag("--pvs-cluster")?.startsWith("{") ? JSON.parse(flag("--pvs-cluster")!) : {} } : {}),
    ...(flag("--bsp") ? { bsp: JSON.parse(flag("--bsp")!) } : {}) };
  const header = ["level", "bsp ms", "total ms", "portals", "vis portals", "clusters ms", "base vis ms", "passage ms", "Σ mightSee", "flow ms", "steps", "facet clips", "separator clips", "Σ portalVis", "Σ pvs", "leaves", "pvs rows", "pvs columns", ...(opts.pvsCluster ? ["pvs clusters", "cluster rows", "Σ cluster pvs (leaves)"] : [])];
  console.log(`| ${header.join(" | ")} |\n|${header.map(() => "---").join("|")}|`);
  const objPath = flag("--obj");
  for (const c of cases(objPath ? { path: objPath, text: readText(objPath) } : null, opts, threads)) {
    if (only && !c.name.includes(only)) continue;
    if (!all && (SLOW.has(c.name) || c.group?.startsWith("Edge"))) continue;
    let r = await c.compile();
    for (let k = 1; k < repeat; k++) r = await c.compile();
    const f = r.flowStats;
    const row = [c.name, ms(r, "bsp").toFixed(0), r.timings.reduce((s, t) => s + t.ms, 0).toFixed(0), r.graph.portals.length, r.clusters?.portalCount ?? r.graph.portals.length, ms(r, "clusters").toFixed(0), ms(r, "base vis").toFixed(0), (ms(r, "passage vis") + ms(r, "passage flood")).toFixed(0), total(r.mightSee), ms(r, "portal flow").toFixed(0),
      f.steps + (f.truncated ? " (trunc)" : ""), f.facetClips, f.separatorClips, total(r.portalVis), total(r.pvs), r.pvs.length, r.pvsTable.rows.length, r.pvsTable.columnRows[0]?.size ?? 0, ...(r.pvsClusters ? clusterCols(r) : [])];
    console.log(`| ${row.join(" | ")} |`);
  }
}
