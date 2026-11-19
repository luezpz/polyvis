/**
 * Phase 6a: the flat base-vis pair test (`flatMightSeeRow`) must give exactly the verdicts of
 * `portalMightSeePortal` (with spheres) on every pair, in both kernels, so base vis never changes.
 */

import { describe, expect, it } from "vitest";
import { type Dim, type Geometry, type PortalGraph, flatMightSeeRow, flattenPortals, portalMightSeePortal, portalSpheres } from "../../src/shared/core";
import * as d2 from "../../src/d2/core";
import * as d3 from "../../src/d3/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";

/** Number of (i, j) pairs where the flat row and the object test disagree. */
function mismatches<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): number {
  const n = graph.portals.length, sp = portalSpheres(g, graph), fp = flattenPortals(g, graph, sp.center, sp.radius);
  const row = new Uint32Array((n + 31) >>> 5);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    row.fill(0);
    flatMightSeeRow(fp, i, row);
    for (let j = 0; j < n; j++) if (((row[j >>> 5] >>> (j & 31)) & 1) === 1 !== portalMightSeePortal(g, graph, i, j, sp)) bad++;
  }
  return bad;
}

describe("flat base vis", () => {
  for (const level of d2.ALL_LEVELS) {
    it(`2d/${level.name}`, () => {
      const graph = d2.buildPortalGraph(d2.buildBsp(d2.buildWalls(level.create().brushes)).tree);
      expect(mismatches(geometry2, graph)).toBe(0);
    });
  }
  for (const level of d3.ALL_LEVELS) {
    it(`3d/${level.name}`, () => {
      const graph = d3.buildPortalGraph(d3.buildBsp(d3.buildWalls(level.create().brushes)).tree);
      expect(mismatches(geometry3, graph)).toBe(0);
    });
  }
});
