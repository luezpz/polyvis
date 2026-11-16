import { describe, expect, it } from "vitest";
import { DEMO_LEVELS, compileLevel, leafComponents, lineOfSight, locateLeaf, type CompileResult } from "../../src/d2/core";
import { emptyLeaves, randomPointInLeaf, rng } from "./helpers";

/** Demos cheap enough for the default suite (Heavy ones take seconds each). */
const CHEAP = DEMO_LEVELS.filter((s) => s.group !== "Heavy");
/** Connected empty components per demo, where not 1. */
const COMPONENTS: Record<string, number> = { "Hairline gap": 3, "Corner kiss": 3, Islands: 4 };

const compiled = new Map(CHEAP.map((s) => [s.name, compileLevel(s.create())]));
const get = (name: string): CompileResult => compiled.get(name)!;
const sees = (r: CompileResult, x0: number, y0: number, x1: number, y1: number): boolean =>
  r.pvs[locateLeaf(r.tree, { x: x0, y: y0 })].has(locateLeaf(r.tree, { x: x1, y: y1 }));

describe("demo levels (2D)", () => {
  it("compile without leaks into the expected number of components", () => {
    for (const s of CHEAP) {
      const r = get(s.name);
      expect(r.leaks.leaking, s.name).toBe(false);
      const comp = leafComponents(r.tree, r.graph);
      expect(new Set(emptyLeaves(r).map((l) => comp[l])).size, s.name).toBe(COMPONENTS[s.name] ?? 1);
    }
  });

  it("hairline gaps and vertex contacts block sight; shared edges do not", () => {
    expect(sees(get("Hairline gap"), 2, 14, 14, 14)).toBe(true);
    expect(sees(get("Hairline gap"), 2, 4, 14, 4)).toBe(false);
    expect(sees(get("Corner kiss"), 4, 4, 12, 12)).toBe(false);
    expect(sees(get("Islands"), 2, 4, 18, 4)).toBe(false);
  });

  it("deep chains and slits behave", () => {
    expect(sees(get("Serpentine"), 1, 1, 1, 77)).toBe(false);
    expect(sees(get("Slit wall"), 10, 10, 31, 10)).toBe(true);
    expect(sees(get("Far from origin"), 4004, -2996, 4014, -2996)).toBe(true);
  });

  it("is never stricter than true line of sight", () => {
    const rand = rng(77);
    let checked = 0;
    for (const s of CHEAP) {
      const r = get(s.name), leaves = emptyLeaves(r);
      for (let k = 0; k < 300; k++) {
        const a = leaves[Math.floor(rand() * leaves.length)], b = leaves[Math.floor(rand() * leaves.length)];
        const p = randomPointInLeaf(r, a, rand), q = randomPointInLeaf(r, b, rand);
        if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
        checked++;
        expect(r.pvs[a].has(b), `${s.name}: leaf ${a} should see leaf ${b}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
