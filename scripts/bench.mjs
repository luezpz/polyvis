// Launcher: runs scripts/bench.ts through Vite's module runner (TS + extensionless imports).
// Default: Heavy + Worst case demos of both dimensions, minus 3D Oblique lattice (~110 s).
// Usage: npm run bench -- [--all] [--only <substring>] [--obj <file.obj>] [--passages] [--threads <n>] [--repeat <k>]
// `--threads n` (with --passages): builds the passage table on n Node worker threads.
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { runnerImport } from "vite";

const args = process.argv.slice(2);
const ti = args.indexOf("--threads");
const threads = ti >= 0 ? Number(args[ti + 1]) : 0;

/** Starts `n` bench threads; each is `{ call(req) → Promise<res> }`, requests matched by id. */
async function startThreads(n) {
  return Promise.all(Array.from({ length: n }, () => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./benchWorker.mjs", import.meta.url));
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
const { module } = await runnerImport(new URL("./bench.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await module.main(args, (path) => readFileSync(path, "utf8"), pool.length ? pool.map((t) => t.call) : null);
for (const t of pool) await t.worker.terminate();
