/**
 * Stable BSP (phase 3.5), both kernels: the tree depends on the walls' geometry, not their order;
 * bounds snap to a grid; and the incremental build (`buildBspIncremental`) equals `buildBsp` exactly.
 */

import { describe, expect, it } from "vitest";
import {
  type BspBuildOptions, type BspCache, type BspTree, type ChildRef, type Dim, type Geometry, type IncrementalBspResult, type Wall,
  buildBsp, buildBspIncremental, isLeafRef, refToLeaf, snapBounds,
} from "../../src/shared/core";
import * as d2 from "../../src/d2/core";
import * as d3 from "../../src/d3/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";

/** A level as wall lists: the original, then each edit (see {@link editsOf}). */
interface Case<D extends Dim> {
  readonly name: string;
  readonly g: Geometry<D>;
  readonly opts: BspBuildOptions;
  readonly versions: readonly (readonly Wall<D>[])[];
}

/** Indices of the brushes to edit: the solids, or every brush if there are none (room-only levels). */
function editable(brushes: readonly { kind: string }[]): number[] {
  const solids = brushes.flatMap((b, i) => (b.kind === "solid" ? [i] : []));
  return solids.length ? solids : brushes.map((_, i) => i);
}

/** The original level and three edits of it (push a face of the first / middle editable brush, drop the last one). */
function editsOf<B extends { kind: string }>(brushes: readonly B[], move: (b: B, face: number, by: number) => B | null): B[][] {
  const s = editable(brushes);
  const moved = (at: number, face: number) => brushes.map((b, k) => (k === at ? (move(b, face, 0.1) ?? b) : b));
  const out: B[][] = [[...brushes]];
  if (s.length === 0) return out;
  out.push(moved(s[0], 0), moved(s[s.length >> 1], 1), brushes.filter((_, k) => k !== s[s.length - 1]));
  return out;
}

const NAMES = new Set(["Complex", "Pillared hall", "Maze 16×16", "Maze 10×10", "Grid city 6×6", "Pillar forest", "Tower", "Round room", "Doors"]);

const cases: Case<Dim>[] = [
  ...d2.ALL_LEVELS.filter((l) => NAMES.has(l.name)).map((l) => ({
    name: `2D ${l.name}`, g: geometry2, opts: d2.DEFAULT_BSP_OPTIONS,
    versions: editsOf(l.create().brushes, d2.moveBrushEdge).map(d2.buildWalls),
  }) as unknown as Case<Dim>),
  ...d3.ALL_LEVELS.filter((l) => NAMES.has(l.name)).map((l) => ({
    name: `3D ${l.name}`, g: geometry3, opts: d3.DEFAULT_BSP_OPTIONS,
    versions: editsOf(l.create().brushes, d3.moveBrushFace).map(d3.buildWalls),
  }) as unknown as Case<Dim>),
];

/** −0 → 0. */
const z = (x: number): number => x + 0;

/** The tree with plane indices replaced by plane numbers and region tags dropped: equal iff the same geometry. */
function shape<D extends Dim>(g: Geometry<D>, t: BspTree<D>): unknown {
  const walk = (r: ChildRef): unknown => {
    if (isLeafRef(r)) {
      const l = t.leaves[refToLeaf(r)];
      return [l.contents, l.depth, l.region ? g.cellVertices(l.region).map((v) => g.coords(v).map(z)) : null];
    }
    const n = t.nodes[r];
    const p = t.planes[n.plane];
    return [[...g.coords(p.n), p.d].map(z), walk(n.front), walk(n.back)];
  };
  return walk(t.root);
}

describe("stable BSP", () => {
  it.each(cases)("$name: wall order does not change the tree", ({ g, opts, versions }) => {
    const walls = versions[0];
    const a = buildBsp(g, walls, opts), b = buildBsp(g, [...walls].reverse(), opts);
    expect(shape(g, b.tree)).toEqual(shape(g, a.tree));
    expect(b.stats).toEqual(a.stats);
  });

  it.each(cases)("$name: incremental build equals buildBsp across edits", ({ g, opts, versions }) => {
    let cache: BspCache<Dim> | null = null;
    // Original, each edit, and back to the original (which must reuse the whole tree).
    for (const walls of [...versions, versions[0]]) {
      const inc: IncrementalBspResult<Dim> = buildBspIncremental(g, walls, opts, cache);
      expect(inc.result).toEqual(buildBsp(g, walls, opts));
      cache = inc.cache;
    }
    const again = buildBspIncremental(g, versions[0], opts, cache);
    expect(again.reusedNodes).toBe(again.result.tree.nodes.length);
  });

  it("reuses most of a closed level after a local edit", () => {
    for (const name of ["2D Maze 16×16", "3D Maze 10×10"]) {
      const { g, opts, versions } = cases.find((c) => c.name === name)!;
      const first = buildBspIncremental(g, versions[0], opts, null);
      const edited = buildBspIncremental(g, versions[2], opts, first.cache);
      expect(edited.reusedNodes / edited.result.tree.nodes.length, name).toBeGreaterThan(0.5);
    }
  });

  it("session ids stay bounded over many distinct edits, and reuse survives the pruning", () => {
    const level = d3.ALL_LEVELS.find((l) => l.name === "Maze 10×10")!, brushes = level.create().brushes;
    const at = editable(brushes)[0], g = geometry3, opts = d3.DEFAULT_BSP_OPTIONS;
    const walls = (by: number) => d3.buildWalls(brushes.map((b, k) => (k === at ? (d3.moveBrushFace(b, 0, by) ?? b) : b)));
    let cache = buildBspIncremental(g, walls(0), opts, null).cache!;
    const size0 = cache.ids.size;
    // Every edit names new walls / splits; only keys the last build used may stay.
    for (let i = 1; i <= 20; i++) cache = buildBspIncremental(g, walls(0.05 * i), opts, cache).cache!;
    expect(cache.ids.size).toBeLessThanOrEqual(size0 + 10); // was +133 before pruning
    const back = buildBspIncremental(g, walls(0), opts, cache);
    expect(back.result).toEqual(buildBsp(g, walls(0), opts));
    expect(back.reusedNodes / back.result.tree.nodes.length).toBeGreaterThan(0.5);
  });

  it("refinement falls back to a plain build", () => {
    const { g, opts, versions } = cases[0];
    const o = { ...opts, cornerSplits: true };
    const inc = buildBspIncremental(g, versions[0], o, null);
    expect(inc.cache).toBeNull();
    expect(inc.result).toEqual(buildBsp(g, versions[0], o));
  });

  it("snapBounds: grows to a coarse grid with at least half a step of margin, stable under small moves", () => {
    const g = geometry3;
    const box = (x0: number, x1: number) => ({ min: { x: x0, y: 0, z: 0 }, max: { x: x1, y: 10, z: 10 } });
    const s = snapBounds(g, box(-4, 40)); // extent 44 → q = 64 / 16 = 4
    expect(s).toEqual({ min: { x: -8, y: -4, z: -4 }, max: { x: 44, y: 12, z: 12 } });
    expect(snapBounds(g, box(-4.1, 40.1))).toEqual(s);
    expect(snapBounds(g, box(-3.9, 39.9))).toEqual(s);
  });
});
