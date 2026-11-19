/** Phase 4 runtime portal clipping: both clip modes conservative w.r.t. ray-tested sight lines, never beyond the PVS. */

import { describe, expect, it } from "vitest";
import {
  SAMPLE_LEVELS, compileLevel, lineOfSight, locateLeaf, visibleLeaves, viewToward, viewFrustum, projectRect,
  leavesInBounds, lightLeaves, anyVisible, packRuntime, runtimePvsRow, createVisCache, type CompileResult,
} from "../../src/d3/core";
import { geometry3 } from "../../src/d3/core/geometry";
import { emptyLeaves, randomLevel, randomPointInLeaf, rng } from "./helpers";

const levels = () => [...SAMPLE_LEVELS.map((s) => s.create()), randomLevel(7), randomLevel(21)];
const modes = ["planes", "rect"] as const;

/** Random eye in a random empty leaf of `r` with a random camera (both null if sampling failed). */
function camera(r: CompileResult, rand: () => number) {
  const leaves = emptyLeaves(r);
  const leaf = leaves[Math.floor(rand() * leaves.length)];
  const eye = randomPointInLeaf(r, leaf, rand);
  const t = rand() * 2 * Math.PI;
  return { leaf, eye, view: viewToward({ x: Math.cos(t), y: Math.sin(t), z: rand() - 0.5 }) };
}

describe("visibleLeaves (3D)", () => {
  it("omnidirectional: never misses a ray-visible leaf and stays inside the PVS row", () => {
    const rand = rng(41);
    let checked = 0;
    for (const level of levels()) {
      const r = compileLevel(level);
      const leaves = emptyLeaves(r);
      for (let k = 0; k < 40; k++) {
        const { leaf: a, eye } = camera(r, rand);
        if (!eye) continue;
        const vis = visibleLeaves(r.graph, a, eye, { pvsRow: r.pvs[a] });
        expect(vis.has(a)).toBe(true);
        expect(vis.hasAnyNotIn(r.pvs[a])).toBe(false);
        for (let j = 0; j < 15; j++) {
          const b = leaves[Math.floor(rand() * leaves.length)];
          const q = randomPointInLeaf(r, b, rand);
          if (!q || !lineOfSight(r.walls, eye, q)) continue;
          checked++;
          expect(vis.has(b), `leaf ${a} eye should see leaf ${b}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it.each(modes)("%s mode with a camera: conservative inside the view, planes ⊆ rect, planes ⊆ omni", (clip) => {
    const rand = rng(8);
    let checked = 0;
    for (const level of levels()) {
      const r = compileLevel(level);
      const leaves = emptyLeaves(r);
      for (let k = 0; k < 30; k++) {
        const { leaf: a, eye, view } = camera(r, rand);
        if (!eye) continue;
        const omni = visibleLeaves(r.graph, a, eye);
        const vis = visibleLeaves(r.graph, a, eye, { clip, view, pvsRow: r.pvs[a] });
        expect(vis.hasAnyNotIn(clip === "planes" ? omni : r.pvs[a])).toBe(false);
        if (clip === "rect") expect(visibleLeaves(r.graph, a, eye, { view }).hasAnyNotIn(vis)).toBe(false);
        const frustum = viewFrustum(eye, view);
        for (let j = 0; j < 15; j++) {
          const b = leaves[Math.floor(rand() * leaves.length)];
          const q = randomPointInLeaf(r, b, rand);
          if (!q || !frustum.every((pl) => geometry3.signedDistance(pl, q) > 1e-3) || !lineOfSight(r.walls, eye, q)) continue;
          checked++;
          expect(vis.has(b)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("is tighter than the PVS somewhere, and rect mode is looser than planes somewhere", () => {
    const rand = rng(5);
    const r = compileLevel(randomLevel(21));
    let tighter = 0, looser = 0;
    for (let k = 0; k < 200; k++) {
      const { leaf, eye, view } = camera(r, rand);
      if (!eye) continue;
      if (visibleLeaves(r.graph, leaf, eye).count() < r.pvs[leaf].count()) tighter++;
      if (visibleLeaves(r.graph, leaf, eye, { clip: "rect", view }).count() > visibleLeaves(r.graph, leaf, eye, { view }).count()) looser++;
    }
    expect(tighter).toBeGreaterThan(0);
    expect(looser).toBeGreaterThan(0);
  });

  it.each(modes)("%s mode: closed portals block everything behind them", (clip) => {
    const r = compileLevel(levels()[0]);
    const a = emptyLeaves(r).find((l) => r.graph.portalsFrom[l].length > 0)!;
    const { eye, view } = camera(r, rng(1));
    const e = randomPointInLeaf(r, a, rng(2))!;
    const open = new Uint8Array(r.graph.portals.length).fill(1);
    for (const p of r.graph.portalsFrom[a]) open[p] = 0;
    expect(eye).toBeTruthy();
    expect(visibleLeaves(r.graph, a, e, { clip, view, portalOpen: open }).toArray()).toEqual([a]);
  });

  it("projectRect: null behind the eye, \"all\" when straddling", () => {
    const view = viewToward(geometry3.vecAt([1, 0, 0], 0));
    const e = geometry3.zero;
    const at = (x: number) => geometry3.vecAt([x, 0.5, 0.5], 0);
    expect(projectRect(e, view, [at(-1), at(-2)])).toBeNull();
    expect(projectRect(e, view, [at(-1), at(2)])).toBe("all");
    expect(projectRect(e, view, [at(1), at(2)])).not.toBeNull();
  });
});

describe("object and light culling (3D)", () => {
  it("leavesInBounds covers the leaf of every point in the box", () => {
    const rand = rng(3);
    for (const level of levels()) {
      const r = compileLevel(level);
      for (let k = 0; k < 30; k++) {
        const { leaf, eye: q } = camera(r, rand);
        if (!q) continue;
        const inBox = leavesInBounds(r.tree, { min: { x: q.x - 0.2, y: q.y - 0.2, z: q.z - 0.2 }, max: { x: q.x + 0.2, y: q.y + 0.2, z: q.z + 0.2 } });
        expect(inBox).toContain(leaf);
        expect(inBox.every((l) => r.tree.leaves[l].contents === "empty")).toBe(true);
        const vis = visibleLeaves(r.graph, leaf, q);
        expect(anyVisible(inBox, vis)).toBe(true);
      }
    }
  });

  it("lightLeaves ⊆ omni visibility and includes the light's leaf", () => {
    const r = compileLevel(randomLevel(7));
    const rand = rng(9);
    for (let k = 0; k < 20; k++) {
      const { leaf, eye: pos } = camera(r, rand);
      if (!pos) continue;
      const lit = lightLeaves(r.tree, r.graph, leaf, pos, 4);
      const vis = visibleLeaves(r.graph, leaf, pos);
      expect(lit).toContain(leaf);
      expect(lit.every((l) => vis.has(l))).toBe(true);
      expect(locateLeaf(r.tree, pos)).toBe(leaf);
    }
  });
});

describe("runtime export (3D)", () => {
  it("packs adjacency, planes, windings and PVS rows faithfully", () => {
    const r = compileLevel(randomLevel(21));
    const d = packRuntime(r.graph, r.pvsTable, [0]);
    const dim = geometry3.dimension;
    expect(d.dimension).toBe(dim);
    expect(d.portalClosed[0]).toBe(1);
    r.graph.portalsFrom.forEach((ids, l) => expect([...d.leafPortals.subarray(d.leafPortalStart[l], d.leafPortalStart[l + 1])]).toEqual(ids));
    r.graph.portals.forEach((p, i) => {
      expect(d.portalTo[i]).toBe(p.to);
      expect([...d.portalPlanes.subarray(i * (dim + 1), (i + 1) * (dim + 1))]).toEqual([...geometry3.coords(p.plane.n), p.plane.d]);
      const pts = geometry3.facetPoints(p.winding).flatMap((v) => geometry3.coords(v));
      expect([...d.vertices.subarray(d.portalVertexStart[i] * dim, d.portalVertexStart[i + 1] * dim)]).toEqual(pts);
    });
    r.pvs.forEach((row, l) => expect(runtimePvsRow(d, l).equals(row)).toBe(true));
  });
});
describe("omnidirectional rect mode (3D)", () => {
  it("covers the precise omnidirectional result", () => {
    const rand = rng(12);
    for (const level of levels()) {
      const r = compileLevel(level);
      for (let k = 0; k < 20; k++) {
        const { leaf, eye } = camera(r, rand);
        if (!eye) continue;
        expect(visibleLeaves(r.graph, leaf, eye).hasAnyNotIn(visibleLeaves(r.graph, leaf, eye, { clip: "rect" }))).toBe(false);
      }
    }
  });
});

describe("subsumption cut (3D)", () => {
  it("keeps queries on an open level bounded (Pillar forest hung without it)", async () => {
    const { DEMO_LEVELS } = await import("../../src/d3/core");
    const r = compileLevel(DEMO_LEVELS.find((s) => s.name === "Pillar forest")!.create(), { flow: { maxSteps: 1000 } });
    const rand = rng(4);
    for (let k = 0; k < 8; k++) {
      const { leaf, eye } = camera(r, rand);
      if (!eye) continue;
      for (const clip of modes) {
        const stats = { crossings: 0 };
        visibleLeaves(r.graph, leaf, eye, { clip, pvsRow: r.pvs[leaf], stats });
        expect(stats.crossings).toBeLessThan(5000);
      }
    }
  });
});

describe("coherence cache (3D)", () => {
  /** Random door flips in place between frames; every cached answer must equal a fresh query (exact reuse). */
  it("cached visible / light results always equal fresh queries; still cameras and unreached doors hit", () => {
    const rand = rng(77);
    for (const level of [randomLevel(7), randomLevel(21)]) {
      const r = compileLevel(level);
      const cache = createVisCache(r.graph, r.tree);
      const open = new Uint8Array(r.graph.portals.length).fill(1);
      let cam = camera(r, rand), light = camera(r, rand);
      for (let frame = 0; frame < 60; frame++) {
        if (rand() < 0.3) cam = camera(r, rand);
        if (rand() < 0.3) open[Math.floor(rand() * open.length)] ^= 1;
        if (!cam.eye || !light.eye) { light = camera(r, rand); continue; }
        for (const clip of modes) {
          const opts = { clip, view: cam.view, pvsRow: r.pvs[cam.leaf], portalOpen: open };
          const got = cache.visible(cam.leaf, cam.eye, opts, clip === "planes" ? 0 : 1);
          expect(got.equals(visibleLeaves(r.graph, cam.leaf, cam.eye, opts))).toBe(true);
        }
        const lit = cache.light(0, light.leaf, light.eye, 4, { portalOpen: open });
        expect(lit).toEqual(lightLeaves(r.tree, r.graph, light.leaf, light.eye, 4, { portalOpen: open }));
      }
      expect(cache.stats.hits).toBeGreaterThan(30);
      expect(cache.stats.misses).toBeGreaterThan(10);
    }
  });

  it("a door the light never read does not invalidate it; one it read does", () => {
    const r = compileLevel(randomLevel(7));
    const rand = rng(5);
    const cache = createVisCache(r.graph, r.tree);
    const open = new Uint8Array(r.graph.portals.length).fill(1);
    let l = camera(r, rand);
    while (!l.eye) l = camera(r, rand);
    const read = new Set<number>();
    lightLeaves(r.tree, r.graph, l.leaf, l.eye, 4, { portalOpen: open, readPortals: read });
    const unread = open.findIndex((_, p) => !read.has(p));
    cache.light(0, l.leaf, l.eye, 4, { portalOpen: open });
    if (unread >= 0) {
      open[unread] = 0;
      cache.light(0, l.leaf, l.eye, 4, { portalOpen: open });
      expect(cache.stats.hits).toBe(1);
    }
    open[[...read][0]] = 0;
    cache.light(0, l.leaf, l.eye, 4, { portalOpen: open });
    expect(cache.stats.misses).toBe(2);
  });
});
