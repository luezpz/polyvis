/**
 * Compile benchmark (docs/OPTIMIZATION-PLAN.md, phase 0): compiles the demo levels of both
 * dimensions single-threaded and prints one Markdown table row per level with the vis
 * stages' times and counters. Run with `npm run bench`; see `bench.mjs` for flags.
 */

import * as d2 from "../src/d2/core";
import * as d3 from "../src/d3/core";
import type { BitSet, CompileOptions, CompileResult, Dim } from "../src/shared/core";

/** Levels slower than this many seconds are skipped unless `--all` (3D Oblique lattice ~110 s). */
const SLOW = new Set(["3d/Oblique lattice"]);

interface Case {
  readonly name: string;
  /** Demo group; edge cases are tiny and skipped unless `--all`. */
  readonly group?: string;
  readonly compile: () => CompileResult<Dim>;
}

/** Sum of the set sizes of `rows`. */
const total = (rows: readonly BitSet[]): number => rows.reduce((s, r) => s + r.count(), 0);

/** Wall-clock ms of `stage` in a result's timings (0 if absent). */
const ms = (r: CompileResult<Dim>, stage: string): number => r.timings.find((t) => t.stage === stage)?.ms ?? 0;

/** Bench cases: every demo of both dimensions, plus an optional OBJ (`obj`: path and file text). */
function cases(obj: { path: string; text: string } | null, opts: Partial<CompileOptions>): Case[] {
  const out: Case[] = [
    ...d2.DEMO_LEVELS.map((s) => ({ name: `2d/${s.name}`, group: s.group, compile: () => d2.compileLevel(s.create(), opts) as CompileResult<Dim> })),
    ...d3.DEMO_LEVELS.map((s) => ({ name: `3d/${s.name}`, group: s.group, compile: () => d3.compileLevel(s.create(), opts) as CompileResult<Dim> })),
  ];
  if (obj) {
    const { faces } = d3.importObj(obj.text);
    const level: d3.Level = { format: d3.LEVEL_FORMAT, version: d3.LEVEL_VERSION, brushes: [], meshes: [{ id: 1, name: "obj", faces }] };
    out.push({ name: `3d/obj ${obj.path}`, compile: () => d3.compileLevel(level, opts) as CompileResult<Dim> });
  }
  return out;
}

/**
 * Entry point. `args`: `--all` (include slow and edge-case levels), `--only <substring>`, `--obj <path>`,
 * `--passages` (phase 2a base vis; "base vis ms" then includes the passage stage).
 * `readText(path)` reads the OBJ (passed in by the Node launcher; core code has no file access).
 */
export function main(args: readonly string[], readText: (path: string) => string): void {
  const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const all = args.includes("--all");
  const only = flag("--only");
  const opts: Partial<CompileOptions> = args.includes("--passages") ? { baseVis: "passages" } : {};
  const header = ["level", "portals", "base vis ms", "Σ mightSee", "flow ms", "steps", "facet clips", "separator clips", "Σ portalVis", "Σ pvs"];
  console.log(`| ${header.join(" | ")} |\n|${header.map(() => "---").join("|")}|`);
  const objPath = flag("--obj");
  for (const c of cases(objPath ? { path: objPath, text: readText(objPath) } : null, opts)) {
    if (only && !c.name.includes(only)) continue;
    if (!all && (SLOW.has(c.name) || c.group?.startsWith("Edge"))) continue;
    const r = c.compile();
    const f = r.flowStats;
    const row = [c.name, r.graph.portals.length, (ms(r, "base vis") + ms(r, "passage vis")).toFixed(0), total(r.mightSee), ms(r, "portal flow").toFixed(0),
      f.steps + (f.truncated ? " (trunc)" : ""), f.facetClips, f.separatorClips, total(r.portalVis), total(r.pvs)];
    console.log(`| ${row.join(" | ")} |`);
  }
}
