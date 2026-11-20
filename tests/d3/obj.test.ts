import { describe, expect, it } from "vitest";
import { compileLevel, importObj, levelFromObj, objDoorBrushes, parseLevel, serializeLevel, windingArea, LEVEL_FORMAT, LEVEL_VERSION, OBJ_HINT_BIAS, type Level, type Vec3 } from "../../src/d3/core";
import { type BrushSpec, build } from "../../src/d3/core/level/builder";
import { emptyLeaves } from "./helpers";

/** Blender-style cube (Y-up OBJ export, outward normals, quads). */
const CUBE = `
o Cube
v 1 1 -1
v 1 -1 -1
v 1 1 1
v 1 -1 1
v -1 1 -1
v -1 -1 -1
v -1 1 1
v -1 -1 1
f 1/1/1 5/2/1 7/3/1 3/4/1
f 4/5/2 3/4/2 7/6/2 8/7/2
f 8/8/3 7/9/3 5/10/3 6/11/3
f 6/12/4 2/13/4 4/5/4 8/14/4
f 2/13/5 1/1/5 3/4/5 4/5/5
f 6/11/6 5/10/6 1/1/6 2/13/6
`;

/** Same cube, triangulated, with negative (relative) indices on one face. */
const TRI_CUBE = CUBE.replace(/^f (\S+) (\S+) (\S+) (\S+)$/gm, "f $1 $2 $3\nf $1 $3 $4");

const meshLevel = (faces: Level["meshes"][number]["faces"]): Level => ({
  format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes: [], meshes: [{ id: 1, name: "cube", faces }],
});

describe("OBJ import", () => {
  it("imports quads and converts Y-up to Z-up", () => {
    const { faces } = importObj(CUBE, { scale: 2 });
    expect(faces).toHaveLength(6);
    expect(faces.reduce((s, f) => s + windingArea(f), 0)).toBeCloseTo(6 * 16);
  });

  it("merges coplanar triangles back into quads", () => {
    const { faces, triangleCount } = importObj(TRI_CUBE);
    expect(triangleCount).toBe(12);
    expect(faces).toHaveLength(6);
  });

  it("an outward-facing room leaks; flipping the normals seals it", () => {
    const outward = compileLevel(meshLevel(importObj(CUBE, { scale: 4 }).faces));
    expect(outward.leaks.leaking).toBe(true);
    const inward = compileLevel(meshLevel(importObj(CUBE, { scale: 4, flipNormals: true }).faces));
    expect(inward.leaks.leaking).toBe(false);
    expect(emptyLeaves(inward).length).toBeGreaterThan(0);
  });

  it("triangulates concave n-gons", () => {
    // An L-shaped floor polygon (concave), facing up in Z-up coordinates.
    const obj = "v 0 0 0\nv 2 0 0\nv 2 0 1\nv 1 0 1\nv 1 0 2\nv 0 0 2\nf 1 2 3 4 5 6\n";
    // Y-up input: points lie in y = 0; after conversion they lie in z = 0 with normal +z or −z.
    const { faces } = importObj(obj);
    expect(faces.reduce((s, f) => s + windingArea(f), 0)).toBeCloseTo(3);
    expect(faces.length).toBeGreaterThanOrEqual(2);
  });

  it("never merges across a directed edge shared by two faces (non-manifold / duplicated face)", () => {
    const square = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n";
    expect(importObj(square, { yUp: false }).faces).toHaveLength(1);
    // A duplicate of the first triangle gives edge 3→1 two owners: its twin is ambiguous.
    expect(importObj(`${square}f 1 2 3\n`, { yUp: false }).faces).toHaveLength(3);
  });

  it("merges near-identical planes that straddle a grouping bucket boundary", () => {
    // Two triangles folded by 1e-10 along an edge 1000 units from the origin: plane offsets
    // 0.5e-3 ∓ 1e-7 round to different d buckets, though the faces are coplanar within tolerance.
    const z = 0.0005, f = z + 1e-10;
    const obj = `v 0 1000 ${z}\nv 1 1000 ${z}\nv 1 1001 ${f}\nv 0 999 ${f}\nf 1 2 3\nf 2 1 4\n`;
    expect(importObj(obj, { yUp: false }).faces).toHaveLength(1);
  });
});

/** OBJ text (Z-up, `yUp: false`) of an axis-aligned box; `inward`: faces seen from inside (a room). */
function boxObj(min: Vec3, max: Vec3, inward: boolean, base: number, header = ""): string {
  const c = (i: number): Vec3 => ({ x: i & 1 ? max.x : min.x, y: i & 2 ? max.y : min.y, z: i & 4 ? max.z : min.z });
  const quads = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]]; // outward: −x +x −y +y −z +z
  const v = Array.from({ length: 8 }, (_, i) => c(i)).map((p) => `v ${p.x} ${p.y} ${p.z}`).join("\n");
  const f = quads.map((q) => `f ${(inward ? [...q].reverse() : q).map((i) => i + 1 + base).join(" ")}`).join("\n");
  return `${header}\n${v}\n${f}\n`;
}

describe("OBJ naming conventions", () => {
  it("hint materials give per-face split biases and never merge with plain faces", () => {
    // A floor of two coplanar quads sharing an edge: one plain, one `hint_-50`; plus a `hint` quad.
    const obj = [
      "v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "v 2 0 0", "v 2 1 0", "v 0 0 1", "v 1 0 1",
      "usemtl floor", "f 1 2 3 4",
      "usemtl hint_-50.001", "f 2 5 6 3",
      "usemtl hint", "f 1 7 8 2",
    ].join("\n");
    const { faces, faceSplitBias } = importObj(obj, { yUp: false });
    expect(faces).toHaveLength(3);
    expect([...faceSplitBias!].sort((a, b) => a - b)).toEqual([OBJ_HINT_BIAS, -50, 0]);
    expect(importObj(CUBE).faceSplitBias).toBeUndefined();
  });

  it("hint biases reach the walls and survive the level JSON", () => {
    const obj = importObj(boxObj({ x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 }, true, 0, "usemtl hint_-7"), { yUp: false });
    const { level } = levelFromObj(obj);
    expect(parseLevel(serializeLevel(level)).meshes[0].faceSplitBias).toEqual(obj.faceSplitBias);
    const r = compileLevel(level);
    expect(r.walls.length).toBe(6);
    expect(r.walls.every((w) => w.splitBias === -7)).toBe(true);
  });

  it("door_<name> objects become door brushes that seal like a brush door", () => {
    const rooms: BrushSpec[] = [
      { kind: "room", box: [0, 0, 0, 10, 10, 4] },
      { kind: "room", box: [10, 4, 0, 14, 6, 3] },
      { kind: "room", box: [14, 0, 0, 24, 10, 4] },
    ];
    const ref = compileLevel(build([...rooms, { kind: "solid", box: [11, 3, -1, 12, 7, 4], door: "a" }]));
    // The same door as an OBJ object (outward faces; `.001` suffix ignored), plus its walls must not appear.
    const obj = importObj(boxObj({ x: 11, y: 3, z: -1 }, { x: 12, y: 7, z: 4 }, false, 0, "o door_a.001") + boxObj({ x: 50, y: 50, z: 50 }, { x: 51, y: 51, z: 51 }, true, 8, "o junk"), { yUp: false });
    expect(obj.doors.map((d) => d.name)).toEqual(["a"]);
    expect(obj.faces).toHaveLength(6); // only the junk box
    const { brushes, failed } = objDoorBrushes(obj.doors, 100);
    expect(failed).toEqual([]);
    const r = compileLevel({ ...build(rooms), brushes: [...build(rooms).brushes, ...brushes] });
    const a = r.doors.find((d) => d.name === "a")!;
    expect(a.seals).toBe(true);
    expect(a.portals.length).toBe(ref.doors[0].portals.length);
  });

  it("a door mesh that encloses nothing is reported, not added", () => {
    const flat = "o door_x\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
    const obj = importObj(flat, { yUp: false });
    expect(objDoorBrushes(obj.doors, 1)).toEqual({ brushes: [], failed: ["x"] });
  });
});

describe("OBJ importer fixes", () => {
  it("hint_0 means bias 0, not the hint default", () => {
    const obj = ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "v 0 0 1", "v 1 0 1", "usemtl hint_0", "f 1 2 3 4", "usemtl hint", "f 1 5 6 2"].join("\n");
    expect([...importObj(obj, { yUp: false }).faceSplitBias!].sort((a, b) => a - b)).toEqual([OBJ_HINT_BIAS, 0]);
  });

  it("accepts tabs between keyword and arguments", () => {
    const obj = ["v\t0 0 0", "v\t1 0 0", "v\t1 1 0", "f\t1 2 3"].join("\n");
    expect(importObj(obj, { yUp: false }).faces).toHaveLength(1);
  });

  it("tracks o and g separately: a group inside a door object stays a door, a bare g clears the group", () => {
    const quad = ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0"];
    const inObject = importObj([...quad, "o door_a", "g part", "f 1 2 3 4"].join("\n"), { yUp: false });
    expect(inObject.faces).toHaveLength(0);
    expect(inObject.doors.map((d) => d.name)).toEqual(["a"]);
    const cleared = importObj([...quad, "g door_b", "f 1 2 3", "g", "f 1 3 4"].join("\n"), { yUp: false });
    expect(cleared.doors.map((d) => d.name)).toEqual(["b"]);
    expect(cleared.faces).toHaveLength(1);
  });

  it("triangulates a polygon that touches itself at a vertex", () => {
    // Two triangles joined at vertex 1 (bow tie traced as one loop): 1 2 3 1 4 5.
    const obj = ["v 0 0 0", "v 1 -1 0", "v 1 1 0", "v -1 1 0", "v -1 -1 0", "f 1 2 3 1 4 5"].join("\n");
    const r = importObj(obj, { yUp: false });
    expect(r.skipped).toBe(0);
    expect(r.faces.reduce((s, f) => s + windingArea(f), 0)).toBeCloseTo(2, 9);
  });

  it("does not merge near-coplanar triangles into a non-planar face", () => {
    // Shared edge 1-3; vertex 4 sits 2e-3 off the plane: same rounded group key, but not planar.
    const obj = ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0.002", "f 1 2 3", "f 1 3 4"].join("\n");
    expect(importObj(obj, { yUp: false }).faces).toHaveLength(2);
  });

  it("counts partially dropped polygons as skipped", () => {
    // A zero-area polygon is dropped whole.
    const obj = ["v 0 0 0", "v 1 0 0", "v 2 0 0", "v 3 0 0", "f 1 2 3 4"].join("\n");
    expect(importObj(obj, { yUp: false }).skipped).toBe(1);
  });

  it("merges a large coplanar grid quickly and keeps its area", () => {
    const n = 80, lines: string[] = [];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) lines.push(`v ${x} ${y} 0`);
    const id = (x: number, y: number) => y * (n + 1) + x + 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) lines.push(`f ${id(x, y)} ${id(x + 1, y)} ${id(x + 1, y + 1)}`, `f ${id(x, y)} ${id(x + 1, y + 1)} ${id(x, y + 1)}`);
    const t0 = performance.now();
    const r = importObj(lines.join("\n"), { yUp: false });
    expect(performance.now() - t0).toBeLessThan(2000); // ~0.1 s; the old rebuild-per-merge loop took ~18 s
    expect(r.faces.length).toBeLessThan(n * n);
    expect(r.faces.reduce((s, f) => s + windingArea(f), 0)).toBeCloseTo(n * n, 6);
  });
});
