import { describe, expect, it } from "vitest";
import {
  BitSet, Side, aabbVolume, baseWindingForPlane, classifyWinding, clipPolyhedron, clipWinding, intersectCoplanarWindings,
  planeFromPoints, polyhedronFromAabb, polyhedronVolume, polyhedronContains, polyhedronSection, windingArea, windingNormal, windingPlane,
  rayWinding, buildSeparators, type Winding,
} from "../../src/d3/core";

const square = (z: number, s = 1): Winding => [
  { x: -s, y: -s, z }, { x: s, y: -s, z }, { x: s, y: s, z }, { x: -s, y: s, z },
];

describe("planes and windings", () => {
  it("front is the side from which the points appear counter-clockwise", () => {
    const p = planeFromPoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })!;
    expect(p.n.z).toBeCloseTo(1);
    expect(windingNormal(square(0)).z).toBeCloseTo(1);
    expect(windingArea(square(0))).toBeCloseTo(4);
  });

  it("base windings are CCW around their plane normal", () => {
    for (const n of [{ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0.6, y: 0, z: 0.8 }]) {
      const w = baseWindingForPlane({ n, d: 2 }, { x: 0, y: 0, z: 0 }, 10);
      const wn = windingNormal(w);
      expect(wn.x * n.x + wn.y * n.y + wn.z * n.z).toBeCloseTo(1);
      expect(windingPlane(w)!.d).toBeCloseTo(2);
    }
  });

  it("clipWinding keeps the front part and discards windings lying on the plane", () => {
    const w = square(0);
    const half = clipWinding(w, { n: { x: 1, y: 0, z: 0 }, d: 0 })!;
    expect(windingArea(half)).toBeCloseTo(2);
    expect(half.every((p) => p.x >= -1e-9)).toBe(true);
    expect(clipWinding(w, { n: { x: 0, y: 0, z: 1 }, d: 0 })).toBeNull();
    expect(clipWinding(w, { n: { x: 0, y: 0, z: 1 }, d: -1 })).toBe(w);
    expect(classifyWinding({ n: { x: 1, y: 0, z: 0 }, d: 0 }, w)).toBe(Side.Spanning);
  });

  it("intersects coplanar windings", () => {
    const a = square(0, 1);
    const b = square(0, 1).map((p) => ({ ...p, x: p.x + 1 }));
    const i = intersectCoplanarWindings(a, b, { x: 0, y: 0, z: 1 })!;
    expect(windingArea(i)).toBeCloseTo(2);
  });

  it("ray / winding intersection", () => {
    const w = square(2);
    const plane = windingPlane(w)!;
    expect(rayWinding({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, w, plane)).toBeCloseTo(2);
    expect(rayWinding({ x: 3, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, w, plane)).toBeNull();
    expect(rayWinding({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, w, plane)).toBeNull();
  });
});

describe("polyhedra", () => {
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 3, z: 4 } };

  it("box polyhedron has outward faces and the right volume", () => {
    const p = polyhedronFromAabb(box, 7);
    expect(polyhedronVolume(p)).toBeCloseTo(aabbVolume(box));
    for (const f of p.faces) {
      const n = windingNormal(f.winding);
      expect(n.x * f.plane.n.x + n.y * f.plane.n.y + n.z * f.plane.n.z).toBeCloseTo(1);
    }
    expect(polyhedronContains(p, { x: 1, y: 1, z: 1 }, true)).toBe(true);
    expect(polyhedronContains(p, { x: 3, y: 1, z: 1 })).toBe(false);
  });

  it("clipping adds a tagged cap and keeps the other tags", () => {
    const p = polyhedronFromAabb(box, 7);
    const diag = { n: { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }, d: Math.SQRT2 }; // keep x + z > 2
    const front = clipPolyhedron(p, diag, 99)!;
    const back = clipPolyhedron(p, { n: { x: -diag.n.x, y: 0, z: -diag.n.z }, d: -diag.d }, 99)!;
    expect(polyhedronVolume(front) + polyhedronVolume(back)).toBeCloseTo(aabbVolume(box));
    expect(front.faces.filter((f) => f.tag === 99)).toHaveLength(1);
    expect(new Set(front.faces.map((f) => f.tag))).toEqual(new Set([7, 99]));
    for (const f of front.faces) {
      const n = windingNormal(f.winding);
      expect(n.x * f.plane.n.x + n.y * f.plane.n.y + n.z * f.plane.n.z).toBeCloseTo(1);
    }
  });

  it("does not overwrite tags when the plane does not cut", () => {
    const p = polyhedronFromAabb(box, 7);
    expect(clipPolyhedron(p, { n: { x: 1, y: 0, z: 0 }, d: 0 }, 1)).toBe(p); // bounding plane: unchanged
    expect(clipPolyhedron(p, { n: { x: 1, y: 0, z: 0 }, d: 5 }, 1)).toBeNull();
  });

  it("cross-sections", () => {
    const s = polyhedronSection(polyhedronFromAabb(box), { n: { x: 0, y: 0, z: 1 }, d: 1 })!;
    expect(windingArea(s)).toBeCloseTo(6);
  });
});

describe("separators", () => {
  it("bound the region visible through two parallel portals", () => {
    const s = square(0, 1); // source at z = 0
    const p = square(2, 1); // pass at z = 2
    const seps = buildSeparators(s, p);
    expect(seps.length).toBeGreaterThan(0);
    // Every separator keeps the pass in front (or on) and the source behind (or on).
    for (const pl of seps) {
      for (const v of p) expect(pl.n.x * v.x + pl.n.y * v.y + pl.n.z * v.z - pl.d).toBeGreaterThanOrEqual(-1e-9);
      for (const v of s) expect(pl.n.x * v.x + pl.n.y * v.y + pl.n.z * v.z - pl.d).toBeLessThanOrEqual(1e-9);
    }
    // Beyond the pass the visible region widens linearly: at z = 4 it spans |x| <= 3.
    const inside = { x: 2.9, y: 0, z: 4 };
    const outside = { x: 3.1, y: 0, z: 4 };
    const front = (q: typeof inside) => seps.every((pl) => pl.n.x * q.x + pl.n.y * q.y + pl.n.z * q.z - pl.d >= 0);
    expect(front(inside)).toBe(true);
    expect(front(outside)).toBe(false);
  });
});

describe("BitSet", () => {
  it("round-trips through hex", () => {
    const b = BitSet.fromIndices(70, [0, 3, 8, 31, 32, 69]);
    expect(b.count()).toBe(6);
    expect(BitSet.fromHex(70, b.toHex()).toArray()).toEqual([0, 3, 8, 31, 32, 69]);
    expect(b.toHex().slice(0, 4)).toBe("0901");
  });
});
