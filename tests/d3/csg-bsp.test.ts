import { describe, expect, it } from "vitest";
import {
  buildWalls, buildBsp, buildLeafSurfaces, locateLeaf, makeEmptySpaceTest, makeBoxBrush, makeBrush, makePrismBrush, moveBrushFace,
  translateBrush, brushVolume, serializeLevel, parseLevel, newellNormal, windingArea, polyhedronVolume, polyhedronAabb, aabbVolume,
  polyhedronVertices, polyhedronFromAabb, wallTouchesRegion, compileLevel, SAMPLE_LEVELS, PROBE_OFFSET, type Wall, type Winding, type ConvexPolyhedron,
} from "../../src/d3/core";
import { boxLevel, randomLevel, rng } from "./helpers";

const totalArea = (walls: readonly Wall[]) => walls.reduce((s, w) => s + windingArea(w.winding), 0);

/** A closed surface has zero vector area: Σ area·n = 0 (independent of T-junctions). */
function expectClosed(walls: readonly Wall[]) {
  let x = 0, y = 0, z = 0;
  for (const w of walls) {
    const n = newellNormal(w.winding);
    x += n.x; y += n.y; z += n.z;
  }
  const scale = Math.max(1, totalArea(walls));
  expect(Math.hypot(x, y, z) / scale).toBeLessThan(1e-9);
}

describe("brushes", () => {
  it("builds boxes and prisms from planes", () => {
    const box = makeBoxBrush(1, "room", { x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 4 })!;
    expect(box.faces).toHaveLength(6);
    expect(brushVolume(box)).toBeCloseTo(24);
    const hex = makePrismBrush(2, "room", Array.from({ length: 6 }, (_, i) => ({ x: Math.cos(i), y: Math.sin(i) })), 0, 2)!;
    expect(hex.faces).toHaveLength(8);
  });

  it("drops redundant planes and rejects unbounded or empty brushes", () => {
    const planes = makeBoxBrush(1, "solid", { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })!.planes;
    const withRedundant = makeBrush(1, "solid", [...planes, { n: { x: 1, y: 0, z: 0 }, d: 5 }])!;
    expect(withRedundant.planes).toHaveLength(6);
    expect(makeBrush(1, "solid", planes.slice(0, 5))).toBeNull(); // open at the top
    expect(makeBrush(1, "solid", [...planes, { n: { x: 1, y: 0, z: 0 }, d: -1 }])).toBeNull(); // empty
  });

  it("translates and pushes faces", () => {
    const box = makeBoxBrush(1, "room", { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })!;
    const moved = translateBrush(box, { x: 1, y: 2, z: 3 })!;
    expect(moved.bounds.min.x).toBeCloseTo(1, 9);
    expect(moved.bounds.min.y).toBeCloseTo(2, 9);
    expect(moved.bounds.min.z).toBeCloseTo(3, 9);
    const top = box.planes.findIndex((p) => p.n.z === 1);
    expect(brushVolume(moveBrushFace(box, top, 1)!)).toBeCloseTo(12);
    expect(moveBrushFace(box, top, -2)).toBeNull();
  });

  it("round-trips through JSON", () => {
    const level = SAMPLE_LEVELS[0].create();
    const back = parseLevel(serializeLevel(level));
    expect(back.brushes).toHaveLength(level.brushes.length);
    back.brushes.forEach((b, i) => expect(brushVolume(b)).toBeCloseTo(brushVolume(level.brushes[i]), 6));
  });
});

describe("CSG walls", () => {
  it("removes faces shared by touching rooms", () => {
    // Two 8×8×4 rooms joined by a 2×2×2 doorway.
    const level = boxLevel([["room", 0, 0, 0, 8, 8, 4], ["room", 8, 3, 0, 10, 5, 2], ["room", 10, 0, 0, 18, 8, 4]]);
    const walls = buildWalls(level.brushes);
    const room = 2 * (8 * 8 + 8 * 4 + 8 * 4);
    const door = 2 * (2 * 2) + 2 * (2 * 2); // side walls and ceiling+floor of the doorway (ends are open)
    expect(totalArea(walls)).toBeCloseTo(2 * room - 2 * 4 + door);
    expectClosed(walls);
  });

  it("merges overlapping rooms into a single outline", () => {
    const level = boxLevel([["room", 0, 0, 0, 4, 4, 4], ["room", 2, 2, 2, 6, 6, 6]]);
    const walls = buildWalls(level.brushes);
    expect(totalArea(walls)).toBeCloseTo(2 * 96 - 2 * 12);
    expectClosed(walls);
  });

  it("de-duplicates identical rooms", () => {
    const level = boxLevel([["room", 0, 0, 0, 4, 4, 4], ["room", 0, 0, 0, 4, 4, 4]]);
    expect(buildWalls(level.brushes)).toHaveLength(6);
  });

  it("carves solid brushes, facing into empty space", () => {
    const level = boxLevel([["room", 0, 0, 0, 10, 10, 10], ["solid", 4, 4, 4, 6, 6, 6]]);
    const walls = buildWalls(level.brushes);
    expect(totalArea(walls)).toBeCloseTo(600 + 24);
    expectClosed(walls);
    const isEmpty = makeEmptySpaceTest(level.brushes);
    for (const w of walls) {
      const c = w.winding.reduce((s, p) => ({ x: s.x + p.x / w.winding.length, y: s.y + p.y / w.winding.length, z: s.z + p.z / w.winding.length }), { x: 0, y: 0, z: 0 });
      expect(isEmpty({ x: c.x + w.plane.n.x * 0.01, y: c.y + w.plane.n.y * 0.01, z: c.z + w.plane.n.z * 0.01 })).toBe(true);
      expect(isEmpty({ x: c.x - w.plane.n.x * 0.01, y: c.y - w.plane.n.y * 0.01, z: c.z - w.plane.n.z * 0.01 })).toBe(false);
    }
  });

  it("produces closed boundaries for sample and random levels", () => {
    for (const s of SAMPLE_LEVELS) expectClosed(buildWalls(s.create().brushes));
    for (let seed = 1; seed <= 20; seed++) expectClosed(buildWalls(randomLevel(seed).brushes));
  });
});

const levels = () => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(3), randomLevel(7), randomLevel(11)];

describe("BSP", () => {
  it("classifies space exactly like the CSG", () => {
    for (const level of levels()) {
      const walls = buildWalls(level.brushes);
      const { tree } = buildBsp(walls, { maxCellSize: 3 });
      const isEmpty = makeEmptySpaceTest(level.brushes);
      const r = rng(42);
      const { min, max } = tree.bounds;
      for (let i = 0; i < 2000; i++) {
        const p = { x: min.x + (max.x - min.x) * r(), y: min.y + (max.y - min.y) * r(), z: min.z + (max.z - min.z) * r() };
        expect(tree.leaves[locateLeaf(tree, p)].contents === "empty").toBe(isEmpty(p));
      }
    }
  });

  it("leaf regions tile the bounding box", () => {
    for (const options of [{ cornerSplits: false }, {}, { maxCellSize: 2 }]) {
      const { tree } = buildBsp(buildWalls(SAMPLE_LEVELS[0].create().brushes), options);
      const volume = tree.leaves.reduce((s, l) => s + (l.region ? polyhedronVolume(l.region) : 0), 0);
      expect(volume / aabbVolume(tree.bounds)).toBeCloseTo(1, 6);
    }
  });

  it("never splits twice by the same plane along a root-to-leaf path (coplanar walls are consumed)", () => {
    for (const level of levels()) {
      const { tree } = buildBsp(buildWalls(level.brushes), { maxCellSize: 3 });
      const walk = (ref: number, seen: Set<number>): void => {
        if (ref < 0) return;
        const node = tree.nodes[ref];
        expect(seen.has(node.plane)).toBe(false);
        const next = new Set(seen).add(node.plane);
        walk(node.front, next);
        walk(node.back, next);
      };
      walk(tree.root, new Set());
    }
  });

  it("assigns every bit of wall area to exactly one empty leaf", () => {
    for (const level of levels()) {
      const walls = buildWalls(level.brushes);
      const { tree } = buildBsp(walls);
      const surfaces = buildLeafSurfaces(tree, walls);
      const area = surfaces.flat().reduce((s, x) => s + windingArea(x.winding), 0);
      expect(area / totalArea(walls)).toBeCloseTo(1, 6);
      surfaces.forEach((list, i) => list.length && expect(tree.leaves[i].contents).toBe("empty"));
    }
  });
});

/** Thickness of the thinner side of `region` when cut by the wall plane (0 if it does not cut). */
function thickness(region: ConvexPolyhedron, w: Wall): number {
  let f = 0, b = 0;
  for (const p of polyhedronVertices(region)) {
    const s = w.plane.n.x * p.x + w.plane.n.y * p.y + w.plane.n.z * p.z - w.plane.d;
    f = Math.max(f, s);
    b = Math.max(b, -s);
  }
  return Math.min(f, b);
}

const touches = (region: ConvexPolyhedron, w: Winding): boolean => wallTouchesRegion(w, region);

/** Bounding boxes `[min, max]` of the empty leaves of a compiled sample level, rounded to 1e-6. */
function emptyLeafBoxes(name: string): [number[], number[]][] {
  const { tree } = compileLevel(SAMPLE_LEVELS.find((s) => s.name === name)!.create(), { bsp: { cornerSplits: true } });
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return tree.leaves.filter((l) => l.contents === "empty" && l.region).map((l) => {
    const b = polyhedronAabb(l.region!)!;
    return [[r(b.min.x), r(b.min.y), r(b.min.z)], [r(b.max.x), r(b.max.y), r(b.max.z)]];
  });
}

describe("BSP refinement", () => {
  it("a wall touching a cell only at a point or along an edge still touches it", () => {
    const cell = polyhedronFromAabb({ min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 3, z: 4 } });
    // Corridor ceiling beyond the cell's corner edge: meets the cell only at (8, 3, 2.5).
    const point: Winding = [{ x: 8, y: 3, z: 2.5 }, { x: 10, y: 3, z: 2.5 }, { x: 10, y: 5, z: 2.5 }, { x: 8, y: 5, z: 2.5 }];
    // Jamb wall in the plane y = 3 beyond x = 8: meets the cell along the edge x = 8, y = 3.
    const edge: Winding = [{ x: 8, y: 3, z: 0 }, { x: 10, y: 3, z: 0 }, { x: 10, y: 3, z: 2.5 }, { x: 8, y: 3, z: 2.5 }];
    const apart: Winding = point.map((p) => ({ ...p, x: p.x + 0.01 }));
    expect(wallTouchesRegion(point, cell)).toBe(true);
    expect(wallTouchesRegion(edge, cell)).toBe(true);
    expect(wallTouchesRegion(apart, cell)).toBe(false);
  });

  it("Two rooms: the cells beside the doorway are split by the corridor ceiling plane", () => {
    const boxes = emptyLeafBoxes("Two rooms");
    // Room cells on the y < 3 side of the door, both rooms: none may span z = 2.5.
    const beside = boxes.filter(([mn, mx]) => mx[1] <= 3 && (mx[0] <= 8 || mn[0] >= 10));
    expect(beside.length).toBeGreaterThan(0);
    for (const [mn, mx] of beside) expect(mn[2] >= 2.5 || mx[2] <= 2.5).toBe(true);
  });

  it("Two storeys: the corridor walls beyond the shaft do not split the upper room", () => {
    const upperRoom = emptyLeafBoxes("Two storeys").filter(([mn, mx]) => mn[2] >= 4 && mx[0] <= 8);
    expect(upperRoom.length).toBeGreaterThan(0);
    for (const [mn, mx] of upperRoom) for (const y of [4, 6]) expect([mn[1], mx[1]]).not.toContain(y);
  });

  it("corner splits: no wall touching an empty leaf extends through it", () => {
    for (const level of levels()) {
      const walls = buildWalls(level.brushes);
      const { tree, stats } = buildBsp(walls, { cornerSplits: true, minCellSize: 0 });
      expect(stats.refineSplitCount).toBeGreaterThan(0);
      for (const leaf of tree.leaves) {
        if (leaf.contents !== "empty" || !leaf.region) continue;
        for (const w of walls) {
          if (!touches(leaf.region, w.winding)) continue;
          expect(thickness(leaf.region, w)).toBeLessThan(PROBE_OFFSET);
        }
      }
    }
  });

  it("corner splits add cells; disabling them restores the plain solid-leaf tree", () => {
    for (const level of levels()) {
      const walls = buildWalls(level.brushes);
      const plain = buildBsp(walls, { cornerSplits: false }).stats;
      const refined = buildBsp(walls, { cornerSplits: true }).stats;
      expect(plain.refineSplitCount).toBe(0);
      expect(refined.emptyLeafCount).toBeGreaterThanOrEqual(plain.emptyLeafCount);
      expect(refined.solidLeafCount).toBe(plain.solidLeafCount);
      expect(refined.splitCount).toBe(plain.splitCount);
    }
  });

  it("max cell size bounds every empty leaf", () => {
    for (const max of [1.5, 3, 6]) {
      for (const level of levels()) {
        const { tree } = buildBsp(buildWalls(level.brushes), { cornerSplits: false, minCellSize: 0, maxCellSize: max });
        for (const leaf of tree.leaves) {
          if (leaf.contents !== "empty" || !leaf.region) continue;
          const b = polyhedronAabb(leaf.region);
          expect(Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z)).toBeLessThanOrEqual(max + 1e-6);
        }
      }
    }
  });

  it("min cell size prevents refinement slivers", () => {
    const min = 1.5;
    for (const level of levels()) {
      const { tree } = buildBsp(buildWalls(level.brushes), { cornerSplits: true, minCellSize: min, maxCellSize: 2 });
      // Every refinement node whose children are both empty leaves splits its region into two parts at least `min` thick.
      for (const node of tree.nodes) {
        const children = [node.front, node.back];
        if (!children.every((c) => c < 0 && tree.leaves[~c].contents === "empty") || !node.region) continue;
        const plane = tree.planes[node.plane];
        const d = polyhedronVertices(node.region).map((v) => plane.n.x * v.x + plane.n.y * v.y + plane.n.z * v.z - plane.d);
        expect(Math.max(...d)).toBeGreaterThanOrEqual(min - 1e-6);
        expect(-Math.min(...d)).toBeGreaterThanOrEqual(min - 1e-6);
      }
    }
  });
});
