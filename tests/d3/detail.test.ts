import { describe, expect, it } from "vitest";
import { DEMO_LEVELS, compileLevel, locateLeaf, moveBrushFace, parseLevel, serializeLevel, translateBrush, withDetail } from "../../src/d3/core";
import { type Brush, buildDetailWalls, makeBoxBrush, windingArea, withDoor } from "../../src/d3/core";

const level = (name: string) => DEMO_LEVELS.find((s) => s.name === name)!.create();

describe("detail brushes (3D)", () => {
  const structural = compileLevel(level("Round room"));
  const detail = compileLevel(level("Round room (detail pillar)"));

  it("do not cut the BSP or produce walls", () => {
    expect(detail.walls.every((w) => w.sourceId === 1)).toBe(true); // only the room's faces
    expect(detail.tree.leaves.length).toBeLessThan(structural.tree.leaves.length);
    expect(detail.leaks.leaking).toBe(false);
  });

  it("do not block sight: opposite sides of the pillar see each other", () => {
    const a = locateLeaf(detail.tree, { x: -8, y: 0, z: 2 }), b = locateLeaf(detail.tree, { x: 8, y: 0, z: 2 });
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

  it("survive serialization, moves and face pushes", () => {
    const lv = level("Round room (detail pillar)");
    const back = parseLevel(serializeLevel(lv));
    expect(back.brushes.map((b) => !!b.detail)).toEqual([false, true]);
    const pillar = lv.brushes.find((b) => b.kind === "solid")!;
    expect(translateBrush(pillar, { x: 1, y: 0, z: 0 })?.detail).toBe(true);
    expect(moveBrushFace(pillar, 0, 0.5)?.detail).toBe(true);
  });
});

describe("detail brush faces are trimmed by CSG (3D)", () => {
  it("drops the part of a detail crate buried in a structural solid", async () => {
    const { build, room, solid } = await import("../../src/d3/core/level/builder");
    // Crate x 4..8 half sunk into a solid block x 6..10: only the part outside the block keeps faces.
    const lv = build([room(0, 0, 0, 10, 10, 4), solid(6, 0, 0, 10, 10, 4), { ...solid(4, 4, 0, 8, 6, 2), detail: true }]);
    const r = compileLevel(lv);
    expect(r.leaks.leaking).toBe(false);
    expect(r.detailWalls.length).toBeGreaterThan(0);
    for (const w of r.detailWalls) for (const p of w.winding) expect(p.x).toBeLessThanOrEqual(6 + 1e-9);
  });
});

describe("detail and door faces flush with a hallway mouth (3D)", () => {
  // Room 10×10×4, hallway x 10..20, y 4..6, a solid block filling the hallway's first unit. Its x = 10 face
  // coincides with the room's wall across the mouth; dedupe used to keep the room's copy and drop it.
  const brushes = (mark: (b: Brush) => Brush) => [
    makeBoxBrush(1, "room", { x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 4 })!,
    makeBoxBrush(2, "room", { x: 10, y: 4, z: 0 }, { x: 20, y: 6, z: 4 })!,
    mark(makeBoxBrush(3, "solid", { x: 10, y: 4, z: 0 }, { x: 11, y: 6, z: 4 })!),
  ];

  for (const [name, mark] of [["detail", (b: Brush) => withDetail(b, true)], ["door", (b: Brush) => withDoor(b, "d")]] as const) {
    it(`keeps both exposed faces of a ${name} brush`, () => {
      const ws = buildDetailWalls(brushes(mark));
      expect(ws.every((w) => w.sourceId === 3)).toBe(true);
      expect(ws.reduce((s, w) => s + windingArea(w.winding), 0)).toBeCloseTo(16, 6); // x = 10 and x = 11, 2×4 each
      expect(ws.filter((w) => w.plane.n.x < -0.99).reduce((s, w) => s + windingArea(w.winding), 0)).toBeCloseTo(8, 6);
    });
  }
});
