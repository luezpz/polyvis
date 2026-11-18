// Node worker_threads entry for `npm run bench -- --threads N`: loads benchWorker.ts through Vite,
// then answers passage requests (rows transferred back).
import { parentPort } from "node:worker_threads";
import { runnerImport } from "vite";

const { module } = await runnerImport(new URL("./benchWorker.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
parentPort.on("message", (req) => {
  const res = module.handle(req);
  parentPort.postMessage(res, res.words ? [res.words.buffer] : []);
});
parentPort.postMessage({ ready: true });
