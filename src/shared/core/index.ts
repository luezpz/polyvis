/**
 * Dimension-agnostic compiler core: everything the 2D and 3D compilers share.
 * Generic over `Dim`; see `geometry.ts` for the seam.
 */

export * from "./math";
export * from "./parallel";
export * from "./spatial";
export * from "./geometry";
export * from "./wall";
export * from "./bsp";
export * from "./portals";
export * from "./doors";
export * from "./vis";
export * from "./runtime";
export * from "./pipeline";
export * from "./export/pvsRows";
export * from "./gen/maze";
