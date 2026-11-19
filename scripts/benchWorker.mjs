// Node worker_threads entry for `npm run bench -- --threads N`: loads the bundled benchWorker
// (built by bench.mjs; `--runner`: benchWorker.ts through Vite's module runner),
// then answers passage requests (rows transferred back).
import { parentPort, workerData } from "node:worker_threads";
import { runnerImport } from "vite";

const module = workerData?.useRunner
  ? (await runnerImport(new URL("./benchWorker.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))).module
  : await import(new URL("../node_modules/.bench/benchWorker.mjs", import.meta.url).href);
parentPort.on("message", (req) => {
  const res = module.handle(req);
  parentPort.postMessage(res, res.words ? [res.words.buffer] : []);
});
parentPort.postMessage({ ready: true });
