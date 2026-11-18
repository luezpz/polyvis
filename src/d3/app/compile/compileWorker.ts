/** Web Worker running the (DOM-free) 3D compiler, so the editor stays responsive; the BSP build, base vis, passage table and portal flow fan out to nested pool workers. */

import { type Level, compileLevelAsync } from "../../core";
import { geometry3 } from "../../core/geometry";
import { createParallelBaseVisRunner } from "../../../shared/app/compile/baseVisPool";
import { createParallelBspRunner } from "../../../shared/app/compile/bspPool";
import { createParallelFlowRunner } from "../../../shared/app/compile/flowPool";
import { createParallelPassageRunner } from "../../../shared/app/compile/passagePool";
import { serveCompiler } from "../../../shared/app/compile/serveCompiler";
import { WorkerPool } from "../../../shared/app/compile/workerPool";

// The URL must be a literal here so Vite bundles the nested worker.
const pool = new WorkerPool(() => new Worker(new URL("./poolWorker.ts", import.meta.url), { type: "module" }));
const runFlow = createParallelFlowRunner(geometry3, pool);
const runBsp = createParallelBspRunner(geometry3, pool);
const runPassages = createParallelPassageRunner(geometry3, pool);
const runBaseVis = createParallelBaseVisRunner(geometry3, pool);

serveCompiler((level: Level, options) => compileLevelAsync(level, options, runFlow, runBsp, runPassages, runBaseVis));
