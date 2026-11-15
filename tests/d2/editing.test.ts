import { describe, expect, it } from "vitest";
import { makeBoxBrush, makeBrush, moveBrushEdge, signedArea, emptyLevel, type Level } from "../../src/d2/core";
import { brushesAt, edgeHandleAt } from "../../src/d2/app/editor/picking";

const sortKey = (vs: readonly { x: number; y: number }[]) => vs.map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)}`).sort();

describe("moveBrushEdge (2D push/pull)", () => {
  const box = makeBoxBrush(1, "room", { x: 0, y: 0 }, { x: 2, y: 1 })!;
  const right = box.vertices.findIndex((v, i) => v.x === 2 && box.vertices[(i + 1) % 4].x === 2);

  it("pushes an edge outwards along its normal, keeping the neighbours' directions", () => {
    const moved = moveBrushEdge(box, right, 1.5)!;
    expect(sortKey(moved.vertices)).toEqual(sortKey([{ x: 0, y: 0 }, { x: 3.5, y: 0 }, { x: 3.5, y: 1 }, { x: 0, y: 1 }]));
    expect(moved.id).toBe(1);
    expect(moved.kind).toBe("room");
  });

  it("pulls inwards with a negative offset and returns null when the brush collapses", () => {
    expect(signedArea(moveBrushEdge(box, right, -1)!.vertices)).toBeCloseTo(1);
    expect(moveBrushEdge(box, right, -2)).toBeNull();
    expect(moveBrushEdge(box, right, -3)).toBeNull();
  });

  it("drops edges that become redundant (triangle tip pushed past)", () => {
    // Trapezoid: pulling the short top edge up turns it into a triangle-ish shape and beyond.
    const trap = makeBrush(2, "solid", [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }])!;
    const top = trap.vertices.findIndex((v, i) => v.y === 1 && trap.vertices[(i + 1) % 4].y === 1);
    const out = moveBrushEdge(trap, top, 5)!; // sides meet at y = 2: the top edge disappears
    expect(out.vertices.length).toBe(3);
    expect(signedArea(out.vertices)).toBeCloseTo(4);
  });
});

describe("2D picking for click-to-cycle and edge handles", () => {
  const big = makeBoxBrush(1, "room", { x: 0, y: 0 }, { x: 10, y: 10 })!;
  const small = makeBoxBrush(2, "solid", { x: 4, y: 4 }, { x: 6, y: 6 })!;
  const level: Level = { ...emptyLevel(), brushes: [big, small] };

  it("lists every brush under the point, smallest first", () => {
    expect(brushesAt(level, { x: 5, y: 5 }).map((b) => b.id)).toEqual([2, 1]);
    expect(brushesAt(level, { x: 1, y: 1 }).map((b) => b.id)).toEqual([1]);
    expect(brushesAt(level, { x: 20, y: 1 })).toEqual([]);
  });

  it("finds edge handles at edge midpoints", () => {
    const i = edgeHandleAt(small, { x: 6.05, y: 5 }, 0.2);
    expect(i).toBeGreaterThanOrEqual(0);
    const a = small.vertices[i], b = small.vertices[(i + 1) % 4];
    expect(a.x).toBe(6);
    expect(b.x).toBe(6);
    expect(edgeHandleAt(small, { x: 5, y: 5 }, 0.2)).toBe(-1);
  });
});
