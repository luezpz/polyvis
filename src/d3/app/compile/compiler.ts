/** Binds the shared {@link CompileClient} to the 3D compiler and its worker. */

import { type Level, compileLevel } from "../../core";
import type { Dim3 } from "../../core/geometry";
import { CompileClient, type CompileListener } from "../../../shared/app/compile/compileClient";

/** Creates a compile client for 3D levels; `listener` receives every finished compile. */
export function createCompileClient(listener: CompileListener<Dim3>): CompileClient<Dim3, Level> {
  return new CompileClient<Dim3, Level>({
    // The URL must be a literal here so Vite bundles the worker.
    createWorker: () => new Worker(new URL("./compileWorker.ts", import.meta.url), { type: "module" }),
    compile: compileLevel,
  }, listener);
}
