// Launcher: bundles scripts/bench.ts (benchBundle.mjs, phase 6c) and runs the bundle, so timings match
// production code. `--runner`: run the TS through Vite's module runner instead (no build step; imports
// in hot loops then cost a getter per read, up to ~15% of a stage).
// Default: Heavy + Worst case demos of both dimensions, minus 3D Oblique lattice (~110 s).
// Usage: npm run bench -- [--all] [--only <substring>] [--obj <file.obj>] [--passages] [--cluster] [--threads <n>] [--repeat <k>] [--runtime [--exact-pvs]] [--runner]
// `--cluster`: vis on convex leaf clusters (phase 3e); "vis portals" = cluster-graph portals.
// `--runtime`: phase 4 runtime portal clipping timings (both clip modes) instead of compile columns;
//   flow capped (base-vis PVS on heavy levels) unless `--exact-pvs`.
// `--threads n`: builds base vis (and, with --passages, the passage table) on n Node worker threads.
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { runnerImport } from "vite";
import { BUNDLE_DIR, bundleBench } from "./benchBundle.mjs";

const args = process.argv.slice(2);
const ti = args.indexOf("--threads");
const threads = ti >= 0 ? Number(args[ti + 1]) : 0;
const useRunner = args.includes("--runner");
if (!useRunner) await bundleBench();

/** Starts `n` bench threads; each is `{ call(req) → Promise<res> }`, requests matched by id. */
async function startThreads(n) {
  return Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./benchWorker.mjs", import.meta.url), { workerData: { useRunner } });
    const pending = new Map();
    let nextId = 1;
    worker.on("error", reject);
    worker.on("message", (m) => {
      if (m.ready) return resolve({ call: (req) => new Promise((ok) => { const id = nextId++; pending.set(id, ok); worker.postMessage({ ...req, id }); }), worker });
      const ok = pending.get(m.id);
      pending.delete(m.id);
      ok(m);
    });
  })));
}

const pool = threads > 0 ? await startThreads(threads) : [];
const module = useRunner
  ? (await runnerImport(new URL("./bench.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))).module
  : await import(new URL("bench.mjs", BUNDLE_DIR).href);
await module.main(args, (path) => readFileSync(path, "utf8"), pool.length ? pool.map((t) => t.call) : null);
for (const t of pool) await t.worker.terminate();
