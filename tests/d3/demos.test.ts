import { describe, expect, it } from "vitest";
import { DEMO_LEVELS, compileLevel, leafComponents, lineOfSight, locateLeaf, type CompileResult } from "../../src/d3/core";
import { emptyLeaves, randomPointInLeaf, rng } from "./helpers";

/** Demos cheap enough for the default suite (Heavy ones take seconds; Oblique lattice ~2 min of flow). */
const CHEAP = DEMO_LEVELS.filter((s) => s.group !== "Heavy" && s.name !== "Oblique lattice");
/** Connected empty components per demo, where not 1. */
const COMPONENTS: Record<string, number> = { "Hairline gap": 3, "Edge & corner kiss": 3, Islands: 4 };

const compiled = new Map(CHEAP.map((s) => [s.name, compileLevel(s.create())]));
const get = (name: string): CompileResult => compiled.get(name)!;
const sees = (r: CompileResult, a: [number, number, number], b: [number, number, number]): boolean =>
  r.pvs[locateLeaf(r.tree, { x: a[0], y: a[1], z: a[2] })].has(locateLeaf(r.tree, { x: b[0], y: b[1], z: b[2] }));

describe("demo levels (3D)", () => {
  it("compile without leaks into the expected number of components", () => {
    for (const s of CHEAP) {
      const r = get(s.name);
      expect(r.leaks.leaking, s.name).toBe(false);
      const comp = leafComponents(r.tree, r.graph);
      expect(new Set(emptyLeaves(r).map((l) => comp[l])).size, s.name).toBe(COMPONENTS[s.name] ?? 1);
    }
  });

  it("hairline gaps, edge and vertex contacts block sight; shared faces do not", () => {
    expect(sees(get("Hairline gap"), [2, 14, 2], [14, 14, 2])).toBe(true);
    expect(sees(get("Hairline gap"), [2, 4, 2], [14, 4, 2])).toBe(false);
    const kiss = get("Edge & corner kiss");
    expect(sees(kiss, [4, 4, 2], [12, 12, 2])).toBe(false);
    expect(sees(kiss, [12, 12, 2], [12, 12, 6])).toBe(true);
    expect(sees(kiss, [12, 12, 6], [20, 4, 10])).toBe(false);
    expect(sees(get("Islands"), [2, 4, 2], [18, 4, 2])).toBe(false);
  });

  it("deep chains and grilles behave", () => {
    expect(sees(get("Serpentine"), [1, 1, 1], [1, 53, 1])).toBe(false);
    expect(sees(get("Vent grille"), [5, 5, 1], [5, 5, 6])).toBe(true);
    expect(sees(get("Far from origin"), [4004, -2996, 502], [4014, -2996, 502])).toBe(true);
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
