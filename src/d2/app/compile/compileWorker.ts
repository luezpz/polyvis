/** Web Worker running the (DOM-free) 2D compiler, so the editor stays responsive; the portal flow fans out to nested flow workers. */

import { type Level, compileLevelAsync } from "../../core";
import { geometry2 } from "../../core/geometry";
import { createParallelFlowRunner } from "../../../shared/app/compile/flowPool";
import { serveCompiler } from "../../../shared/app/compile/serveCompiler";

// The URL must be a literal here so Vite bundles the nested worker.
const runFlow = createParallelFlowRunner(geometry2, () => new Worker(new URL("./flowWorker.ts", import.meta.url), { type: "module" }));

serveCompiler((level: Level, options) => compileLevelAsync(level, options, runFlow));
