/**
 * Web Worker running the (DOM-free) compiler, so the editor stays responsive
 * while the 3D portal flow runs.
 */

import { compileLevel } from "../../core";
import type { CompileRequest, CompileResponse } from "./protocol";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<CompileRequest>) => void) | null;
  postMessage(message: CompileResponse): void;
};

scope.onmessage = (e) => {
  const { id, level, options } = e.data;
  const t0 = performance.now();
  try {
    const result = compileLevel(level, options);
    scope.postMessage({ id, result, ms: performance.now() - t0 });
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
