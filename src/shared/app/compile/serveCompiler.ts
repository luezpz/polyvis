/**
 * Worker side of the compile protocol: answers each {@link CompileRequest}
 * with the result (or the error message) of `compile`. Each dimension's
 * worker entry is one call to this, so Vite can bundle it statically.
 */

import type { CompileOptions, CompileResult, Dim } from "../../core";
import type { CompileRequest, CompileResponse } from "./protocol";

/** Installs the message handler on the worker global scope. `compile` is the dimension's `compileLevel`. */
export function serveCompiler<D extends Dim, L>(compile: (level: L, options: Partial<CompileOptions>) => CompileResult<D>): void {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent<CompileRequest<L>>) => void) | null;
    postMessage(message: CompileResponse<D>): void;
  };
  scope.onmessage = (e) => {
    const { id, level, options } = e.data;
    const t0 = performance.now();
    try {
      const result = compile(level, options);
      scope.postMessage({ id, result, ms: performance.now() - t0 });
    } catch (err) {
      scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
