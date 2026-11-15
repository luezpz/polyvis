import { describe, expect, it } from "vitest";
import {
  compileLevel, compileWalls, locateLeaf, leafComponents, makeWall, lineOfSight, SAMPLE_LEVELS,
  exportPvsJson, exportPvsText, decodePvsRow, decodeLeafPvs, pvsRowOf, type Wall, type Level, type CompileOptions, type PvsDocument,
} from "../../src/d3/core";
import { boxLevel, emptyLeaves, randomLevel, randomPointInLeaf, rng } from "./helpers";

const sample = (name: string): Level => SAMPLE_LEVELS.find((s) => s.name === name)!.create();

describe("portals", () => {
  it("connects all empty leaves of a connected level", () => {
    for (const s of SAMPLE_LEVELS) {
      const result = compileLevel(s.create());
      const comp = leafComponents(result.tree, result.graph);
      const ids = new Set(emptyLeaves(result).map((l) => comp[l]));
      expect(ids.size, s.name).toBe(1);
    }
  });

  it("creates consistent twin portals", () => {
    const { graph } = compileLevel(SAMPLE_LEVELS[0].create());
    expect(graph.portals.length % 2).toBe(0);
    for (const p of graph.portals) {
      const t = graph.portals[p.twin];
      expect(t.twin).toBe(p.id);
      expect(t.from).toBe(p.to);
      expect(t.to).toBe(p.from);
      // Twins lie on the same plane with opposite orientation.
      expect(p.plane.n.x * t.plane.n.x + p.plane.n.y * t.plane.n.y + p.plane.n.z * t.plane.n.z).toBeCloseTo(-1);
    }
  });

  it("orients portals into their destination leaf", () => {
    const r = compileLevel(SAMPLE_LEVELS[0].create());
    for (const p of r.graph.portals) {
      const c = p.winding.reduce((s, v) => ({ x: s.x + v.x / p.winding.length, y: s.y + v.y / p.winding.length, z: s.z + v.z / p.winding.length }), { x: 0, y: 0, z: 0 });
      const ahead = { x: c.x + p.plane.n.x * 1e-3, y: c.y + p.plane.n.y * 1e-3, z: c.z + p.plane.n.z * 1e-3 };
      const behind = { x: c.x - p.plane.n.x * 1e-3, y: c.y - p.plane.n.y * 1e-3, z: c.z - p.plane.n.z * 1e-3 };
      expect(locateLeaf(r.tree, ahead)).toBe(p.to);
      expect(locateLeaf(r.tree, behind)).toBe(p.from);
    }
  });

  it("finds no leaks in CSG levels", () => {
    for (const s of SAMPLE_LEVELS) expect(compileLevel(s.create()).leaks.leaking, s.name).toBe(false);
  });

  it("detects leaks in open wall sets but still compiles", () => {
    // A box room (normals inward) with the ceiling missing.
    const box = boxLevel([["room", 0, 0, 0, 10, 10, 10]]);
    const walls: Wall[] = box.brushes[0].faces
      .filter((f) => f.plane.n.z !== 1)
      .map((f) => makeWall([...f.winding].reverse())!);
    const result = compileWalls(walls);
    expect(result.leaks.leaking).toBe(true);
    expect(result.leaks.outsideLeaves.length).toBeGreaterThan(0);
  });
});

/** Samples random point pairs in random leaves; whenever they see each other the PVS must say so. */
function checkConservative(levels: Level[], options: Partial<CompileOptions>, pairs: number, seed: number): number {
  const rand = rng(seed);
  let checked = 0;
  for (const level of levels) {
    const r = compileLevel(level, options);
    const leaves = emptyLeaves(r);
    for (let k = 0; k < pairs; k++) {
      const a = leaves[Math.floor(rand() * leaves.length)];
      const b = leaves[Math.floor(rand() * leaves.length)];
      const p = randomPointInLeaf(r, a, rand);
      const q = randomPointInLeaf(r, b, rand);
      if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
      checked++;
      expect(r.pvs[a].has(b), `${JSON.stringify(options)}: leaf ${a} should see leaf ${b} (p=${JSON.stringify(p)} q=${JSON.stringify(q)})`).toBe(true);
    }
  }
  return checked;
}

describe("PVS", () => {
  const leafAt = (r: ReturnType<typeof compileLevel>, x: number, y: number, z: number) => locateLeaf(r.tree, { x, y, z });

  it("two rooms joined by a doorway see each other (unrefined cells)", () => {
    const r = compileLevel(sample("Two rooms"), { bsp: { cornerSplits: false } });
    for (const a of emptyLeaves(r)) for (const b of emptyLeaves(r)) expect(r.pvs[a].has(b)).toBe(true);
  });

  it("corner splits cull cells hidden behind a door jamb", () => {
    const r = compileLevel(sample("Two rooms"));
    const doorway = leafAt(r, 9, 4, 1);
    for (const b of emptyLeaves(r)) expect(r.pvs[doorway].has(b)).toBe(true);
    const leaves = emptyLeaves(r);
    expect(leaves.some((a) => leaves.some((b) => !r.pvs[a].has(b)))).toBe(true);
    const plain = compileLevel(sample("Two rooms"), { bsp: { cornerSplits: false } });
    expect(r.summary.averageVisibleFraction).toBeLessThan(plain.summary.averageVisibleFraction);
  });

  it("culls the far end of a zigzag corridor", () => {
    const r = compileLevel(sample("Zigzag"));
    const start = leafAt(r, 3, 3, 1.5);
    const end = leafAt(r, 27, 17, 1.5);
    expect(r.tree.leaves[start].contents).toBe("empty");
    expect(r.tree.leaves[end].contents).toBe("empty");
    expect(r.pvs[start].has(end)).toBe(false);
    expect(r.pvs[end].has(start)).toBe(false);
    expect(r.summary.averageVisibleFraction).toBeLessThan(0.8);
  });

  it("separates storeys: the far upper room cannot see the far ground room", () => {
    const r = compileLevel(sample("Two storeys"));
    const upperFar = leafAt(r, 26, 5, 5);
    const groundFar = leafAt(r, -14, 5, 1);
    expect(r.pvs[upperFar].has(groundFar)).toBe(false);
    // ...but the ground floor sees the upper floor through the stair shaft.
    expect(r.pvs[leafAt(r, 10, 5, 1)].has(leafAt(r, 10, 5, 6))).toBe(true);
  });

  it("is never stricter than true line of sight (sample levels)", () => {
    const checked = checkConservative(SAMPLE_LEVELS.map((s) => s.create()), {}, 500, 1234);
    expect(checked).toBeGreaterThan(400);
  });

  it("is never stricter than true line of sight (random levels)", () => {
    const levels = Array.from({ length: 10 }, (_, i) => randomLevel(100 + i, 7));
    const checked = checkConservative(levels, {}, 400, 99);
    expect(checked).toBeGreaterThan(500);
  });

  it("is never stricter than true line of sight with refinement options", () => {
    const levels = [SAMPLE_LEVELS[0].create(), randomLevel(7), randomLevel(21)];
    let checked = 0;
    for (const bsp of [{ cornerSplits: false }, { minCellSize: 0 }, { maxCellSize: 3 }, { maxCellSize: 2, minCellSize: 1.5 }]) {
      checked += checkConservative(levels, { bsp }, 250, 7);
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("symmetry modes are ordered: intersect ⊆ none ⊆ union", () => {
    const level = SAMPLE_LEVELS[0].create();
    const none = compileLevel(level, { symmetry: "none" }).pvs;
    const inter = compileLevel(level, { symmetry: "intersect" }).pvs;
    const union = compileLevel(level, { symmetry: "union" }).pvs;
    none.forEach((row, i) => {
      expect(inter[i].hasAnyNotIn(row)).toBe(false);
      expect(row.hasAnyNotIn(union[i])).toBe(false);
    });
  });

  it("flow is at least as tight as base vis, and strictly tighter somewhere", () => {
    const r = compileLevel(SAMPLE_LEVELS[0].create());
    r.portalVis.forEach((v, i) => expect(v.hasAnyNotIn(r.mightSee[i])).toBe(false));
    expect(r.summary.averagePortalVis).toBeLessThan(r.summary.averageMightSee);
  });

  it("truncated flow falls back to base vis (still conservative)", () => {
    const r = compileLevel(SAMPLE_LEVELS[0].create(), { flow: { maxSteps: 50 } });
    expect(r.flowStats.truncated).toBe(true);
    r.portalVis.forEach((v, i) => expect(v.equals(r.mightSee[i]) || !v.hasAnyNotIn(r.mightSee[i])).toBe(true));
  });
});

describe("shared PVS rows", () => {
  const levels = () => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(104, 7)];

  it("decodes back to the original PVS bit for bit", () => {
    for (const level of levels()) {
      const r = compileLevel(level);
      expect(r.pvsTable.leafRow).toHaveLength(r.pvs.length);
      r.pvs.forEach((row, leaf) => expect(pvsRowOf(r.pvsTable, leaf).equals(row)).toBe(true));
    }
  });

  it("stores each distinct row exactly once", () => {
    for (const level of levels()) {
      const r = compileLevel(level);
      const hex = r.pvsTable.rows.map((row) => row.toHex());
      expect(new Set(hex).size).toBe(hex.length);
      expect(hex.length).toBe(new Set(r.pvs.map((row) => row.toHex())).size);
      // Every row is used, and all solid leaves share the single empty row.
      expect(new Set(r.pvsTable.leafRow).size).toBe(hex.length);
      const solidRows = new Set(r.tree.leaves.flatMap((l, i) => (l.contents === "solid" ? [r.pvsTable.leafRow[i]] : [])));
      expect(solidRows.size).toBe(1);
      expect(r.pvsTable.rows[[...solidRows][0]].count()).toBe(0);
    }
  });

  it("actually removes duplicates", () => {
    const r = compileLevel(sample("Zigzag"));
    expect(r.pvsTable.rows.length).toBeLessThan(r.pvs.length);
  });
});

describe("export", () => {
  it("encodes the same PVS in JSON and text, through the shared-row indirection", () => {
    const r = compileLevel(sample("Zigzag"));
    const doc = JSON.parse(exportPvsJson(r)) as PvsDocument;
    expect(doc.format).toBe("polyvis-pvs-3d");
    expect(doc.version).toBe(2);
    expect(doc.leaves).toHaveLength(r.tree.leaves.length);
    expect(doc.pvs.rows).toHaveLength(r.pvsTable.rows.length);
    r.pvs.forEach((row, leaf) => expect(decodeLeafPvs(doc, leaf)).toEqual(row.toArray()));

    const text = exportPvsText(r).trim().split("\n");
    expect(text[0]).toBe("polyvis-pvs-3d 2");
    const leavesHeader = text.findIndex((l) => l.startsWith("leaves "));
    const leafLines = text.slice(leavesHeader + 1, leavesHeader + 1 + r.tree.leaves.length);
    const pvsHeader = text.findIndex((l) => l.startsWith("pvs "));
    expect(text[pvsHeader]).toBe(`pvs ${r.pvsTable.rows.length} hex-lsb`);
    const rows = text.slice(pvsHeader + 1);
    expect(rows).toHaveLength(r.pvsTable.rows.length);
    leafLines.forEach((line, leaf) => {
      // <contents> <6 bbox numbers | -> <pvsRow> ...
      const tok = line.split(" ");
      const rowIndex = Number(tok[1] === "-" ? tok[2] : tok[7]);
      expect(decodePvsRow(rows[rowIndex])).toEqual(r.pvs[leaf].toArray());
    });
  });
});
