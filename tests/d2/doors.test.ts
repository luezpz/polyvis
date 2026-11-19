/** Phase 4b occluding doors (2D): door leaf splits, sealing, runtime closing, conservative bake. */

import { describe, expect, it } from "vitest";
import {
  compileLevel, closedDoorPortals, doorPortalOpen, exportPvsJson, lineOfSight, locateLeaf, parseLevel, serializeLevel, visibleLeaves,
  type CompileResult, type PvsDocument, type Vec2,
} from "../../src/d2/core";
import { build } from "../../src/d2/core/level/builder";
import { geometry2 } from "../../src/d2/core/geometry";
import { cellCentroid, insideVolume } from "../../src/shared/core";
import { DEMO_LEVELS } from "../../src/d2/core/level/demos";
import { emptyLeaves, randomPointInLeaf, rng } from "./helpers";

/** Two rooms joined by a corridor; door "a" fills the corridor, door "b" floats in room A (seals nothing). */
const level = () => build([
  { kind: "room", box: [0, 0, 10, 10] },
  { kind: "room", box: [10, 4, 14, 6] },
  { kind: "room", box: [14, 0, 24, 10] },
  { kind: "solid", box: [11, 3, 12, 7], door: "a" },
  { kind: "solid", box: [3, 3, 4, 4], door: "b" },
]);

const centroidX = (r: CompileResult, leaf: number): number => cellCentroid(geometry2, r.tree.leaves[leaf].region!).x;

describe("occluding doors (2D)", () => {
  const r = compileLevel(level());
  const a = r.doors.find((d) => d.name === "a")!, b = r.doors.find((d) => d.name === "b")!;

  it("door brushes are not structural and every empty leaf is wholly inside or outside a door", () => {
    expect(r.walls.some((w) => w.winding.a.x === 11 || w.winding.a.x === 12)).toBe(false);
    const doorLines = [{ n: { x: 1, y: 0 }, d: 11 }, { n: { x: -1, y: 0 }, d: -12 }, { n: { x: 0, y: 1 }, d: 3 }, { n: { x: 0, y: -1 }, d: -7 }];
    for (const leaf of emptyLeaves(r)) {
      const vs = r.tree.leaves[leaf].region!.vertices;
      const inside = insideVolume(geometry2, cellCentroid(geometry2, r.tree.leaves[leaf].region!), doorLines, 0);
      for (const v of vs) for (const l of doorLines) if (inside) expect(geometry2.signedDistance(l, v)).toBeGreaterThan(-1e-6);
      expect(inside).toBe(a.leaves.includes(leaf));
    }
    expect(a.leaves.length).toBeGreaterThan(0);
    expect(r.bspStats.leafCount).toBe(r.tree.leaves.length);
  });

  it("a door across the corridor seals; a door in open space does not", () => {
    expect(a.seals).toBe(true);
    expect(a.portals.length).toBeGreaterThan(0);
    for (const p of a.portals) expect(a.leaves.includes(r.graph.portals[p].from) !== a.leaves.includes(r.graph.portals[p].to)).toBe(true);
    expect(b.seals).toBe(false);
  });

  it("closed door hides everything behind it; open door shows it", () => {
    const eye: Vec2 = { x: 2, y: 5 };
    const leaf = locateLeaf(r.tree, eye);
    const beyond = emptyLeaves(r).filter((l) => centroidX(r, l) > 12);
    const open = visibleLeaves(r.graph, leaf, eye, { pvsRow: r.pvs[leaf] });
    expect(beyond.some((l) => open.has(l))).toBe(true);
    const portalOpen = doorPortalOpen(r.graph.portals.length, r.doors, ["a"]);
    const shut = visibleLeaves(r.graph, leaf, eye, { pvsRow: r.pvs[leaf], portalOpen });
    expect(beyond.some((l) => shut.has(l))).toBe(false);
    // Closing the non-sealing door changes nothing down the corridor.
    const onlyB = visibleLeaves(r.graph, leaf, eye, { pvsRow: r.pvs[leaf], portalOpen: doorPortalOpen(r.graph.portals.length, r.doors, ["b"]) });
    expect(beyond.filter((l) => open.has(l)).every((l) => onlyB.has(l))).toBe(true);
  });

  it("the PVS is baked with doors open (conservative w.r.t. ray-tested sight lines)", () => {
    const rand = rng(5);
    const leaves = emptyLeaves(r);
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const la = leaves[Math.floor(rand() * leaves.length)], lb = leaves[Math.floor(rand() * leaves.length)];
      const p = randomPointInLeaf(r, la, rand), q = randomPointInLeaf(r, lb, rand);
      if (!p || !q || !lineOfSight(r.walls, p, q)) continue;
      checked++;
      expect(r.pvs[la].has(lb)).toBe(true);
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("door names survive serialization and closed doors reach the export", () => {
    const back = parseLevel(serializeLevel(level()));
    expect(back.brushes.map((x) => x.door)).toEqual([undefined, undefined, undefined, "a", "b"]);
    const doc = JSON.parse(exportPvsJson(r, closedDoorPortals(r.doors, ["a"]))) as PvsDocument;
    expect(doc.portals.flatMap((p, i) => (p.closed ? [i] : []))).toEqual([...a.portals].sort((x, y) => x - y));
  });

  it("Doors demo: the doorway door seals, the one with a gap does not", () => {
    const demo = compileLevel(DEMO_LEVELS.find((x) => x.name === "Doors")!.create());
    expect(demo.doors.map((x) => [x.name, x.seals])).toEqual([["west", true], ["loose", false]]);
  });
});
