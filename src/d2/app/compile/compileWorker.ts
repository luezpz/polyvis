/** Web Worker running the (DOM-free) 2D compiler, so the editor stays responsive; the BSP build, passage table and portal flow fan out to nested pool workers. */

import { type Level, compileLevelAsync } from "../../core";
import { geometry2 } from "../../core/geometry";
import { createParallelBspRunner } from "../../../shared/app/compile/bspPool";
import { createParallelFlowRunner } from "../../../shared/app/compile/flowPool";
import { createParallelPassageRunner } from "../../../shared/app/compile/passagePool";
import { serveCompiler } from "../../../shared/app/compile/serveCompiler";
import { WorkerPool } from "../../../shared/app/compile/workerPool";

// The URL must be a literal here so Vite bundles the nested worker.
const pool = new WorkerPool(() => new Worker(new URL("./poolWorker.ts", import.meta.url), { type: "module" }));
const runFlow = createParallelFlowRunner(geometry2, pool);
const runBsp = createParallelBspRunner(geometry2, pool);
const runPassages = createParallelPassageRunner(geometry2, pool);

serveCompiler((level: Level, options) => compileLevelAsync(level, options, runFlow, runBsp, runPassages));
