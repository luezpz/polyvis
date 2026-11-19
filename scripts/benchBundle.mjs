// Bundles scripts/bench.ts + scripts/benchWorker.ts into node_modules/.bench (phase 6c,
// docs/OPTIMIZATION-PLAN.md): one ESM module per entry, imports flattened into plain bindings, so the
// bench times production-like code instead of Vite's module runner (getter per imported binding).
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Out dir of the bundle; `bench.mjs` / `benchWorker.mjs` import from it. */
export const BUNDLE_DIR = new URL("../node_modules/.bench/", import.meta.url);

/** Builds both bench entries (unminified, Node target) into {@link BUNDLE_DIR}. */
export async function bundleBench() {
  await build({
    configFile: false,
    logLevel: "warn",
    root: here(".."),
    build: {
      ssr: true,
      target: "node22",
      minify: false,
      outDir: fileURLToPath(BUNDLE_DIR),
      emptyOutDir: true,
      rollupOptions: {
        input: { bench: here("./bench.ts"), benchWorker: here("./benchWorker.ts") },
        output: { format: "es", entryFileNames: "[name].mjs" },
      },
    },
  });
}
