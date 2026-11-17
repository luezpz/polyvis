import { describe, expect, it } from "vitest";
import { DEMO_LEVELS, compileLevel, locateLeaf, moveBrushEdge, parseLevel, serializeLevel, withDetail } from "../../src/d2/core";

const level = (name: string) => DEMO_LEVELS.find((s) => s.name === name)!.create();

describe("detail brushes (2D)", () => {
  const structural = compileLevel(level("Round room"));
  const detail = compileLevel(level("Round room (detail pillar)"));

  it("do not cut the BSP or produce walls", () => {
    expect(detail.walls.length).toBe(64); // only the room's edges
    expect(detail.tree.leaves.length).toBeLessThan(structural.tree.leaves.length);
    expect(detail.leaks.leaking).toBe(false);
  });

  it("do not block sight: opposite sides of the pillar see each other", () => {
    const a = locateLeaf(detail.tree, { x: -8, y: 0 }), b = locateLeaf(detail.tree, { x: 8, y: 0 });
    expect(detail.pvs[a].has(b)).toBe(true);
  });

  it("still go through CSG: their faces come back trimmed, outside the BSP", () => {
    expect(structural.detailWalls).toEqual([]);
    expect(detail.detailWalls.length).toBeGreaterThan(0);
    expect(detail.detailWalls.every((w) => w.sourceId === 2)).toBe(true);
    // Same faces as the pillar's walls in the structural build: CSG of all brushes.
    expect(detail.detailWalls.length).toBe(structural.walls.filter((w) => w.sourceId === 2).length);
  });

  it("are ignored on rooms", () => {
    const lv = level("Round room");
    const r = compileLevel({ ...lv, brushes: lv.brushes.map((b) => (b.kind === "room" ? withDetail(b, true) : b)) });
    expect(r.walls.length).toBe(structural.walls.length);
  });

  it("survive serialization and edge moves", () => {
    const lv = level("Round room (detail pillar)");
    expect(parseLevel(serializeLevel(lv)).brushes.map((b) => !!b.detail)).toEqual([false, true]);
    const pillar = lv.brushes.find((b) => b.kind === "solid")!;
    expect(moveBrushEdge(pillar, 0, 0.5)?.detail).toBe(true);
    expect("detail" in withDetail(pillar, false)).toBe(false);
  });
});
