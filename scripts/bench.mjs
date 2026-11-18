// Launcher: runs scripts/bench.ts through Vite's module runner (TS + extensionless imports).
// Default: Heavy + Worst case demos of both dimensions, minus 3D Oblique lattice (~110 s).
// Usage: npm run bench -- [--all] [--only <substring>] [--obj <file.obj>] [--passages]
import { readFileSync } from "node:fs";
import { runnerImport } from "vite";

const { module } = await runnerImport(new URL("./bench.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await module.main(process.argv.slice(2), (path) => readFileSync(path, "utf8"));
