/**
 * Phase 6b: the flat flow (`vis/flatFlow.ts` + each kernel's `flatFlow`) must give exactly the object
 * flow's rows and counters, in both kernels, for every option combination that changes the walk.
 */

import { describe, expect, it } from "vitest";
import { type Dim, type Geometry, type PortalFlowOptions, type PortalGraph, computeBaseVis, computePassages, computePortalFlow, flowFromSource } from "../../src/shared/core";
import * as d2 from "../../src/d2/core";
import * as d3 from "../../src/d3/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";

/** Option sets: defaults, no source clipping, no separator cache, passages; capped so heavy levels stay fast (and truncate). */
const VARIANTS: readonly [string, Partial<PortalFlowOptions>][] = [
  ["default", {}],
  ["no clipSource", { clipSource: false }],
  ["no cacheSeparators", { cacheSeparators: false }],
];
const MAX_STEPS = 150_000;

function check<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): void {
  const base = computeBaseVis(g, graph);
  const variants: [string, Partial<PortalFlowOptions>][] = [...VARIANTS, ["passages", { passages: computePassages(g, graph, base) }]];
  for (const [name, opts] of variants) {
    const o = { ...opts, maxSteps: MAX_STEPS };
    const ref = computePortalFlow(g, graph, base, { ...o, flat: false });
    const got = computePortalFlow(g, graph, base, { ...o, flat: true });
    expect(got.stats, name).toEqual(ref.stats);
    expect(got.portalVis.map((r) => r.toHex()), name).toEqual(ref.portalVis.map((r) => r.toHex()));
  }
}

describe("flat flow", () => {
  for (const level of d2.ALL_LEVELS) {
    it(`2d/${level.name}`, () => check(geometry2, d2.buildPortalGraph(d2.buildBsp(d2.buildWalls(level.create().brushes)).tree)), 60_000);
  }
  for (const level of d3.ALL_LEVELS) {
    it(`3d/${level.name}`, () => check(geometry3, d3.buildPortalGraph(d3.buildBsp(d3.buildWalls(level.create().brushes)).tree)), 60_000);
  }
});

describe("flowFromSource scratch", () => {
  it("leaves onChain zeroed without a full clear (flat and object paths)", () => {
    const graph = d3.buildPortalGraph(d3.buildBsp(d3.buildWalls(d3.ALL_LEVELS[0].create().brushes)).tree);
    const base = computeBaseVis(geometry3, graph);
    const onChain = new Uint8Array(graph.leafCount);
    for (const flat of [true, false]) {
      for (let s = 0; s < graph.portals.length; s++) {
        flowFromSource(geometry3, graph, base, [], s, true, Infinity, onChain, null, true, null, flat);
        expect(onChain.every((v) => v === 0)).toBe(true);
      }
    }
  });
});
