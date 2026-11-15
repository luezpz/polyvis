import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  worker: { format: "es" },
  build: {
    // Multi-page app: a landing page plus one editor per dimension.
    rollupOptions: { input: ["index.html", "2d.html", "3d.html"] },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // 3D portal flow over randomized levels takes seconds, not milliseconds.
    testTimeout: 120_000,
  },
});
