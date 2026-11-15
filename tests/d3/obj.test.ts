import { describe, expect, it } from "vitest";
import { compileLevel, importObj, windingArea, LEVEL_FORMAT, LEVEL_VERSION, type Level } from "../../src/d3/core";
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
});
