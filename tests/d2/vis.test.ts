import { describe, expect, it } from "vitest";
import {
  compileLevel, compileWalls, locateLeaf, leafComponents, makeWall, lineOfSight, castRay, SAMPLE_LEVELS,
  exportPvsJson, exportPvsText, decodePvsRow, decodeLeafPvs, packRuntime, pvsRowOf, pvsTableSees, type Wall, type Level, type PvsDocument,
} from "../../src/d2/core";
import { BitSet } from "../../src/shared/core";
import { boxLevel, emptyLeaves, randomLevel, randomPointInLeaf, rng } from "./helpers";

const sample = (name: string): Level => SAMPLE_LEVELS.find((s) => s.name === name)!.create();

describe("portals", () => {
  it("connects all empty leaves of a connected level", () => {
    for (const sample of SAMPLE_LEVELS) {
      const result = compileLevel(sample.create());
      const comp = leafComponents(result.tree, result.graph);
      const ids = new Set(emptyLeaves(result).map((l) => comp[l]));
      expect(ids.size, sample.name).toBe(1);
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
      // Twins lie on the same line with opposite orientation.
      expect(p.plane.n.x * t.plane.n.x + p.plane.n.y * t.plane.n.y).toBeCloseTo(-1);
    }
  });

  it("orients portals into their destination leaf", () => {
    const r = compileLevel(SAMPLE_LEVELS[0].create());
    for (const p of r.graph.portals) {
      const c = { x: (p.winding.a.x + p.winding.b.x) / 2, y: (p.winding.a.y + p.winding.b.y) / 2 };
      const ahead = { x: c.x + p.plane.n.x * 1e-3, y: c.y + p.plane.n.y * 1e-3 };
      const behind = { x: c.x - p.plane.n.x * 1e-3, y: c.y - p.plane.n.y * 1e-3 };
      expect(locateLeaf(r.tree, ahead)).toBe(p.to);
      expect(locateLeaf(r.tree, behind)).toBe(p.from);
    }
  });

  it("finds no leaks in CSG levels", () => {
    for (const sample of SAMPLE_LEVELS) expect(compileLevel(sample.create()).leaks.leaking).toBe(false);
  });

  it("detects leaks in open wall sets but still compiles", () => {
    // A box with one wall missing.
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const walls: Wall[] = [];
    for (let i = 0; i < 3; i++) walls.push(makeWall({ a: pts[i], b: pts[i + 1] })!);
    const result = compileWalls(walls);
    expect(result.leaks.leaking).toBe(true);
    expect(result.leaks.outsideLeaves.length).toBeGreaterThan(0);
  });
});

describe("PVS", () => {
  const leafAt = (r: ReturnType<typeof compileLevel>, x: number, y: number) => locateLeaf(r.tree, { x, y });

  it("two rooms joined by a doorway see each other (unrefined cells)", () => {
    const r = compileLevel(SAMPLE_LEVELS.find((s) => s.name === "Two rooms")!.create(), { bsp: { cornerSplits: false } });
    for (const a of emptyLeaves(r)) for (const b of emptyLeaves(r)) expect(r.pvs[a].has(b)).toBe(true);
  });

  it("corner splits cull cells hidden behind a door jamb", () => {
    const r = compileLevel(SAMPLE_LEVELS.find((s) => s.name === "Two rooms")!.create(), { bsp: { cornerSplits: true } });
    const doorway = leafAt(r, 9, 4);
    for (const b of emptyLeaves(r)) expect(r.pvs[doorway].has(b)).toBe(true);
    // With the jamb extensions some cells of one room are hidden from cells of the other.
    const leaves = emptyLeaves(r);
    expect(leaves.some((a) => leaves.some((b) => !r.pvs[a].has(b)))).toBe(true);
    expect(r.summary.averageVisibleFraction).toBeLessThan(compileLevel(SAMPLE_LEVELS.find((s) => s.name === "Two rooms")!.create(), { bsp: { cornerSplits: false } }).summary.averageVisibleFraction);
  });

  it("is never stricter than true line of sight with refinement options", () => {
    const optionSets = [{ cornerSplits: false }, { minCellSize: 0 }, { maxCellSize: 3 }, { maxCellSize: 2, minCellSize: 1.5 }];
    const rand = rng(99);
    let checked = 0;
    for (const bsp of optionSets) {
      for (const level of [SAMPLE_LEVELS[0].create(), randomLevel(7, 8), randomLevel(21, 8)]) {
        const r = compileLevel(level, { bsp });
        const leaves = emptyLeaves(r);
        for (let k = 0; k < 300; k++) {
          const a = leaves[Math.floor(rand() * leaves.length)];
          const b = leaves[Math.floor(rand() * leaves.length)];
          const p = randomPointInLeaf(r, a, rand);
          const q = randomPointInLeaf(r, b, rand);
          if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
          checked++;
          expect(r.pvs[a].has(b), `${JSON.stringify(bsp)}: leaf ${a} should see leaf ${b}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("culls the far end of a zigzag corridor", () => {
    const r = compileLevel(SAMPLE_LEVELS.find((s) => s.name === "Zigzag")!.create());
    const start = leafAt(r, 3, 3);
    const end = leafAt(r, 27, 17);
    expect(r.tree.leaves[start].contents).toBe("empty");
    expect(r.tree.leaves[end].contents).toBe("empty");
    expect(r.pvs[start].has(end)).toBe(false);
    expect(r.pvs[end].has(start)).toBe(false);
    expect(r.summary.averageVisibleFraction).toBeLessThan(0.8);
  });

  it("is never stricter than true line of sight (sampled, sample levels + random levels)", () => {
    const levels = [...SAMPLE_LEVELS.map((s) => s.create()), ...Array.from({ length: 12 }, (_, i) => randomLevel(100 + i, 10))];
    const rand = rng(1234);
    let checked = 0;
    for (const level of levels) {
      const r = compileLevel(level);
      const leaves = emptyLeaves(r);
      for (let k = 0; k < 400; k++) {
        const a = leaves[Math.floor(rand() * leaves.length)];
        const b = leaves[Math.floor(rand() * leaves.length)];
        const p = randomPointInLeaf(r, a, rand);
        const q = randomPointInLeaf(r, b, rand);
        if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
        checked++;
        expect(r.pvs[a].has(b), `leaf ${a} should see leaf ${b} (p=${p.x},${p.y} q=${q.x},${q.y})`).toBe(true);
      }
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
    r.portalVis.forEach((v, i) => expect(v.hasAnyNotIn(r.mightSee[i])).toBe(false));
  });
});

describe("analysis", () => {
  it("castRay hits the nearest wall and agrees with lineOfSight", () => {
    const r = compileLevel(boxLevel([["room", 0, 0, 10, 10]]));
    const hit = castRay(r.walls, { x: 2, y: 5 }, { x: 3, y: 0 })!;
    expect(hit.t).toBeCloseTo(8);
    expect(hit.point.x).toBeCloseTo(10);
    expect(r.walls[hit.wall].plane.n.x).toBeCloseTo(-1);
    expect(castRay(r.walls, { x: 2, y: 5 }, { x: 1, y: 0 }, 5)).toBeNull();
    expect(lineOfSight(r.walls, { x: 1, y: 1 }, { x: 9, y: 9 })).toBe(true);
    expect(lineOfSight(r.walls, { x: 1, y: 1 }, { x: 11, y: 1 })).toBe(false);
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

  it("column sharing decodes back to the original PVS bit for bit, with fewer columns", () => {
    for (const level of levels()) {
      const r = compileLevel(level);
      const t = r.pvsTable;
      expect(t.leafColumn).toHaveLength(r.pvs.length);
      expect(t.columnRows).toHaveLength(t.rows.length);
      const groups = new Set(t.leafColumn).size;
      t.columnRows.forEach((row) => expect(row.size).toBe(groups));
      r.pvs.forEach((row, a) => {
        for (let b = 0; b < r.pvs.length; b++) expect(pvsTableSees(t, a, b)).toBe(row.has(b));
      });
      // All solid leaves are never visible, so they share one column.
      const solidCols = new Set(r.tree.leaves.flatMap((l, i) => (l.contents === "solid" ? [t.leafColumn[i]] : [])));
      expect(solidCols.size).toBe(1);
      expect(groups).toBeLessThan(r.pvs.length);
    }
  });
});

describe("export", () => {
  it("encodes the same PVS in JSON and text, through the shared-row indirection", () => {
    const r = compileLevel(sample("Zigzag"));
    const doc = JSON.parse(exportPvsJson(r)) as PvsDocument;
    expect(doc.format).toBe("polyvis-pvs-2d");
    expect(doc.version).toBe(3);
    expect(doc.walls).toHaveLength(r.walls.length);
    expect(doc.leaves).toHaveLength(r.tree.leaves.length);
    expect(doc.pvs.rows).toHaveLength(r.pvsTable.rows.length);
    r.pvs.forEach((row, leaf) => expect(decodeLeafPvs(doc, leaf)).toEqual(row.toArray()));
    // Leaf wall lists match the leaf surfaces; solid leaves list none.
    doc.leaves.forEach((l, i) => {
      expect(l.walls).toEqual([...new Set(r.surfaces[i].map((s) => s.wall))].sort((a, b) => a - b));
      if (l.contents === "solid") expect(l.walls).toEqual([]);
    });

    const text = exportPvsText(r).trim().split("\n");
    expect(text[0]).toBe("polyvis-pvs-2d 3");
    expect(text).toContain(`walls ${r.walls.length}`);
    const leavesHeader = text.findIndex((l) => l.startsWith("leaves "));
    const leafLines = text.slice(leavesHeader + 1, leavesHeader + 1 + r.tree.leaves.length);
    const pvsHeader = text.findIndex((l) => l.startsWith("pvs "));
    expect(text[pvsHeader]).toBe(`pvs ${r.pvsTable.rows.length} hex-lsb`);
    const rows = text.slice(pvsHeader + 1);
    expect(rows).toHaveLength(r.pvsTable.rows.length);
    leafLines.forEach((line, leaf) => {
      // <contents> <pvsRow> <nwalls> <wall>... <nverts> <x y>...
      const tok = line.split(" ");
      const nwalls = Number(tok[2]);
      expect(tok.slice(3, 3 + nwalls).map(Number)).toEqual(doc.leaves[leaf].walls);
      expect(decodePvsRow(rows[Number(tok[1])])).toEqual(r.pvs[leaf].toArray());
    });
  });

  it("v3: exports each portal's plane and closed flag, matching packRuntime", () => {
    const r = compileLevel(sample("Zigzag"));
    const doc = JSON.parse(exportPvsJson(r, [0])) as PvsDocument;
    const packed = packRuntime(r.graph, r.pvsTable, [0]);
    doc.portals.forEach((p, i) => {
      expect(p.closed).toBe(packed.portalClosed[i] === 1);
      p.plane.forEach((x, k) => expect(x).toBeCloseTo(packed.portalPlanes[i * 3 + k], 5));
    });
    const text = exportPvsText(r, [0]).trim().split("\n");
    const header = text.findIndex((l) => l.startsWith("portals "));
    text.slice(header + 1, header + 1 + doc.portals.length).forEach((line, i) => {
      // <from> <to> <closed> <plane...> ...
      const tok = line.split(" ").map(Number);
      expect(tok.slice(0, 3)).toEqual([doc.portals[i].from, doc.portals[i].to, i === 0 ? 1 : 0]);
      expect(tok.slice(3, 3 + 3)).toEqual(doc.portals[i].plane);
    });
  });
});

describe("base vis sphere pre-test (1a)", () => {
  it("gives the same mightSee as plain classification", async () => {
    const { computeBaseVis } = await import("../../src/d2/core/vis/vis");
    for (const level of [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)]) {
      const { graph } = compileLevel(level);
      const fast = computeBaseVis(graph, true), plain = computeBaseVis(graph, false);
      for (let i = 0; i < plain.length; i++) expect(fast[i].equals(plain[i])).toBe(true);
    }
  });
});

describe("separator caching (1b)", () => {
  it("clipFacetToPlanes(separators) equals clipToSeparators", async () => {
    const { geometry2: g } = await import("../../src/d2/core/geometry");
    const { portals } = compileLevel(randomLevel(7, 8)).graph;
    const r = rng(3);
    for (let k = 0; k < 400; k++) {
      const [a, b, c] = [0, 1, 2].map(() => portals[Math.floor(r() * portals.length)].winding);
      expect(g.clipFacetToPlanes(c, g.separators(a, b))).toEqual(g.clipToSeparators(a, b, c));
    }
  });

  it("gives the same portal flow as uncached", async () => {
    const { computeBaseVis, computePortalFlow } = await import("../../src/d2/core/vis/vis");
    for (const level of [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(21, 8)]) {
      const { graph } = compileLevel(level);
      const might = computeBaseVis(graph);
      const on = computePortalFlow(graph, might), off = computePortalFlow(graph, might, { cacheSeparators: false });
      for (let i = 0; i < might.length; i++) expect(on.portalVis[i].equals(off.portalVis[i])).toBe(true);
    }
  });
});

describe("passage vis (2a + 2b)", () => {
  it("canSee rows hold only base-vis portals; mightSee' is a subset that covers the flow", async () => {
    const { computeBaseVis, computePassages, passageMightSee, computePortalFlow } = await import("../../src/d2/core/vis/vis");
    for (const level of [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(21, 8)]) {
      const { graph } = compileLevel(level);
      const base = computeBaseVis(graph), table = computePassages(graph, base)!;
      expect(table.slot[graph.portals.length]).toBe(graph.portals.reduce((s, p) => s + graph.portalsFrom[p.to].length, 0));
      const tight = passageMightSee(graph, table);
      const flow = computePortalFlow(graph, base);
      for (let p = 0; p < base.length; p++) {
        expect(tight[p].hasAnyNotIn(base[p])).toBe(false);
        expect(flow.portalVis[p].hasAnyNotIn(tight[p])).toBe(false);
        graph.portalsFrom[graph.portals[p].to].forEach((_t, j) => {
          const row = new BitSet(base.length, table.words.slice((table.slot[p] + j) * table.wordsPerRow, (table.slot[p] + j + 1) * table.wordsPerRow));
          expect(row.hasAnyNotIn(base[p])).toBe(false);
        });
      }
    }
  });

  it("flow with passages (base order) is a subset of the plain flow, with no more steps", () => {
    for (const level of [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)]) {
      const plain = compileLevel(level), pass = compileLevel(level, { baseVis: "passages" });
      expect(pass.flowStats.steps).toBeLessThanOrEqual(plain.flowStats.steps);
      for (let p = 0; p < plain.portalVis.length; p++) expect(pass.portalVis[p].hasAnyNotIn(plain.portalVis[p])).toBe(false);
    }
  });

  it("is never stricter than true line of sight", () => {
    const rand = rng(77);
    let checked = 0;
    for (const level of [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)]) {
      const r = compileLevel(level, { baseVis: "passages" });
      const leaves = emptyLeaves(r);
      for (let k = 0; k < 300; k++) {
        const a = leaves[Math.floor(rand() * leaves.length)];
        const b = leaves[Math.floor(rand() * leaves.length)];
        const p = randomPointInLeaf(r, a, rand);
        const q = randomPointInLeaf(r, b, rand);
        if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
        checked++;
        expect(r.pvs[a].has(b), `leaf ${a} should see leaf ${b}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("vis clusters (3e)", () => {
  const modes = [{ cluster: "convex" }, { cluster: "convex", clusterOptions: { acrossRefinement: true } }] as const;

  it("is never stricter than true line of sight", () => {
    const rand = rng(78);
    let checked = 0;
    for (const opts of modes) {
      for (const level of [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)]) {
        const r = compileLevel(level, opts);
        const leaves = emptyLeaves(r);
        for (let k = 0; k < 300; k++) {
          const a = leaves[Math.floor(rand() * leaves.length)];
          const b = leaves[Math.floor(rand() * leaves.length)];
          const p = randomPointInLeaf(r, a, rand);
          const q = randomPointInLeaf(r, b, rand);
          if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
          checked++;
          expect(r.pvs[a].has(b), `leaf ${a} should see leaf ${b}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("gives every leaf of a cluster the same row, with fewer flow portals", () => {
    expect(compileLevel(SAMPLE_LEVELS[0].create()).clusters).toBeNull();
    for (const opts of modes) {
      const r = compileLevel(SAMPLE_LEVELS[0].create(), opts);
      const c = r.clusters!;
      expect(c.portalCount).toBeLessThan(r.graph.portals.length);
      for (const a of emptyLeaves(r)) for (const b of emptyLeaves(r)) if (c.leafCluster[a] === c.leafCluster[b]) expect(r.pvs[a].equals(r.pvs[b])).toBe(true);
    }
  });
});

describe("PVS clusters (phase 3b)", () => {
  const levels = () => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(104, 7)];

  it("are conservative: a visible leaf's cluster is visible from the viewer's cluster", () => {
    for (const level of levels()) {
      const r = compileLevel(level, { pvsCluster: "wide" });
      const c = r.pvsClusters!;
      expect(c.leafCluster).toHaveLength(r.pvs.length);
      expect(c.pvs).toHaveLength(c.count);
      r.pvs.forEach((row, a) => {
        for (const b of row.toArray()) expect(c.pvs[c.leafCluster[a]].has(c.leafCluster[b])).toBe(true);
      });
      // The export table decodes back to the cluster rows; the leaf PVS is untouched.
      c.pvs.forEach((row, k) => expect(pvsRowOf(c.table, k).equals(row)).toBe(true));
      expect(r.pvs.map((x) => x.toHex())).toEqual(compileLevel(level).pvs.map((x) => x.toHex()));
    }
  });

  it("merge leaves, cap cluster size, and keep all solid leaves together", () => {
    for (const level of levels()) {
      const r = compileLevel(level, { pvsCluster: "wide", pvsClusterOptions: { maxLeaves: 3 } });
      const c = r.pvsClusters!;
      const sizes = new Map<number, number>();
      r.tree.leaves.forEach((l, i) => { if (l.contents === "empty") sizes.set(c.leafCluster[i], (sizes.get(c.leafCluster[i]) ?? 0) + 1); });
      for (const s of sizes.values()) expect(s).toBeLessThanOrEqual(3);
      const solid = new Set(r.tree.leaves.flatMap((l, i) => (l.contents === "empty" ? [] : [c.leafCluster[i]])));
      expect(solid.size).toBeLessThanOrEqual(1);
    }
    const r = compileLevel(levels()[levels().length - 1], { pvsCluster: "wide" });
    expect(r.pvsClusters!.count).toBeLessThan(r.pvs.length);
    expect(compileLevel(levels()[0]).pvsClusters).toBeNull();
  });
});

describe("splitter heuristic (3f)", () => {
  it("is never stricter than true line of sight, and facing weight retires coplanar walls (fewer leaves)", () => {
    const levels = [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7, 8), randomLevel(21, 8)];
    const rand = rng(79);
    let checked = 0;
    for (const bsp of [{ facingWeight: 4 }, { maxCandidates: 4 }]) {
      for (const level of levels) {
        const r = compileLevel(level, { bsp });
        const leaves = emptyLeaves(r);
        for (let k = 0; k < 300; k++) {
          const a = leaves[Math.floor(rand() * leaves.length)];
          const b = leaves[Math.floor(rand() * leaves.length)];
          const p = randomPointInLeaf(r, a, rand);
          const q = randomPointInLeaf(r, b, rand);
          if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
          checked++;
          expect(r.pvs[a].has(b), `leaf ${a} should see leaf ${b}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(400);
    const leafCount = (o: object) => levels.reduce((s, l) => s + compileLevel(l, { bsp: o }).tree.leaves.length, 0);
    expect(leafCount({ facingWeight: 4 })).toBeLessThan(leafCount({}));
  });
});
