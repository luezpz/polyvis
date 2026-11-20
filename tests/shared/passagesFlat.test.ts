/**
 * Phase 6a leftover: the flat passage table builder must equal the object one bit for bit, on
 * every level, in both kernels (so `baseVis: "passages"` never changes).
 */

import { describe, expect, it } from "vitest";
import { type Dim, type Geometry, type PortalGraph, computeBaseVis, createPassageRows, passageSlots } from "../../src/shared/core";
import * as d2 from "../../src/d2/core";
import * as d3 from "../../src/d3/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";

/** Flat and object canSee words of the whole graph. */
function both<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): [Uint32Array, Uint32Array] {
  const base = computeBaseVis(g, graph), slot = passageSlots(graph), n = graph.portals.length;
  return [createPassageRows(g, graph, base, slot, true)(0, n), createPassageRows(g, graph, base, slot, false)(0, n)];
}

describe("flat passages", () => {
  for (const level of d2.ALL_LEVELS) {
    it(`2d/${level.name}`, () => {
      const [flat, obj] = both(geometry2, d2.buildPortalGraph(d2.buildBsp(d2.buildWalls(level.create().brushes)).tree));
      expect(flat).toEqual(obj);
    });
  }
  for (const level of d3.ALL_LEVELS) {
    it(`3d/${level.name}`, () => {
      const [flat, obj] = both(geometry3, d3.buildPortalGraph(d3.buildBsp(d3.buildWalls(level.create().brushes)).tree));
      expect(flat).toEqual(obj);
    });
  }
});
