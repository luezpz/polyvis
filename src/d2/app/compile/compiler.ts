/** Binds the shared {@link CompileClient} to the 2D compiler and its worker. */

import { type Level, compileLevel } from "../../core";
import type { Dim2 } from "../../core/geometry";
import { CompileClient, type CompileListener } from "../../../shared/app/compile/compileClient";

/** Creates a compile client for 2D levels; `listener` receives every finished compile. */
export function createCompileClient(listener: CompileListener<Dim2>): CompileClient<Dim2, Level> {
  return new CompileClient<Dim2, Level>({
    // The URL must be a literal here so Vite bundles the worker.
    createWorker: () => new Worker(new URL("./compileWorker.ts", import.meta.url), { type: "module" }),
    compile: compileLevel,
  }, listener);
}
