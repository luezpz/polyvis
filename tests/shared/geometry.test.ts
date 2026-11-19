/**
 * Contract tests for the `Geometry` seam: both kernels must behave the same
 * way on the operations the shared stages rely on.
 */

import { describe, expect, it } from "vitest";
import { type Dim, type Geometry, Side } from "../../src/shared/core";
import { geometry2 } from "../../src/d2/core/geometry";
import { geometry3 } from "../../src/d3/core/geometry";

const kernels: [string, Geometry<Dim>][] = [
  ["2D", geometry2 as unknown as Geometry<Dim>],
  ["3D", geometry3 as unknown as Geometry<Dim>],
];

/** Unit box `[0, 1]^dim` and the plane `x = 0.5` facing +x. */
function fixtures(g: Geometry<Dim>) {
  const pt = (...c: number[]) => (g.dimension === 2 ? { x: c[0], y: c[1] } : { x: c[0], y: c[1], z: c[2] ?? 0 });
  const box = { min: pt(0, 0, 0), max: pt(1, 1, 1) };
  return { pt, box, plane: g.axisPlane(0, 0.5) };
}

describe.each(kernels)("%s geometry kernel", (_, g) => {
  it("axis planes face the positive axis", () => {
    const { pt, plane } = fixtures(g);
    expect(g.signedDistance(plane, pt(1, 0, 0))).toBeCloseTo(0.5);
    expect(g.sameOrientedPlane(plane, g.flipPlane(plane))).toBe(false);
    expect(g.sameOrientedPlane(plane, g.flipPlane(g.flipPlane(plane)))).toBe(true);
  });

  it("clipCell tags the new boundary and halves the box", () => {
    const { box, plane } = fixtures(g);
    const cell = g.cellFromBounds(box, -2);
    const front = g.clipCell(cell, plane, 7)!;
    expect(g.cellHasTag(front, 7)).toBe(true);
    expect(g.cellHasTag(front, -2)).toBe(true);
    const b = g.boundsOf(g.cellVertices(front))!;
    expect(g.coords(b.min)[0]).toBeCloseTo(0.5);
    // Fully in front: unchanged, so existing tags are never overwritten.
    expect(g.clipCell(cell, g.axisPlane(0, -1), 9)).toBe(cell);
    expect(g.clipCell(cell, g.axisPlane(0, 2), 9)).toBeNull();
  });

  it("retagCell maps every boundary tag and keeps the shape", () => {
    const { box, plane } = fixtures(g);
    const front = g.clipCell(g.cellFromBounds(box, -2), plane, 7)!;
    const moved = g.retagCell(front, (t) => (t === 7 ? 12 : t));
    expect(g.cellHasTag(moved, 12)).toBe(true);
    expect(g.cellHasTag(moved, 7)).toBe(false);
    expect(g.cellHasTag(moved, -2)).toBe(true);
    expect(g.cellVertices(moved)).toEqual(g.cellVertices(front));
  });

  it("pack/unpack round-trips facets, cells and vectors back to back", () => {
    const { box, plane } = fixtures(g);
    const cell = g.clipCell(g.cellFromBounds(box, -2), plane, 7)!;
    const facet = spanning(g);
    const out: number[] = [];
    g.packFacet(facet, out);
    g.packCell(cell, out);
    out.push(...g.coords(plane.n));
    const data = Float64Array.from(out);
    const [f, at1] = g.unpackFacet(data, 0);
    const [c, at2] = g.unpackCell(data, at1);
    expect(f).toEqual(facet);
    expect(c).toEqual(cell);
    expect(g.vecAt(data, at2)).toEqual(plane.n);
    expect(at2 + g.dimension).toBe(data.length);
  });

  it("facetMeasure is length in 2D and area in 3D", () => {
    // spanning(): 2D segment of length 1, 3D unit square; clipped at x = 0.5 it halves.
    expect(g.facetMeasure(spanning(g))).toBeCloseTo(1);
    expect(g.facetMeasure(g.clipFacet(spanning(g), fixtures(g).plane)!)).toBeCloseTo(0.5);
  });

  it("clipFacet keeps the front part, returns unchanged facets as-is, and drops facets on the plane", () => {
    const { plane } = fixtures(g);
    const f = spanning(g);
    expect(g.classifyFacet(plane, f)).toBe(Side.Spanning);
    const front = g.clipFacet(f, plane)!;
    expect(g.classifyFacet(plane, front)).toBe(Side.Front);
    expect(Math.min(...g.facetPoints(front).map((p) => g.coords(p)[0]))).toBeCloseTo(0.5);
    expect(g.clipFacet(f, g.axisPlane(0, -1))).toBe(f);
    expect(g.clipFacet(f, g.axisPlane(0, 2))).toBeNull();
    // Lying exactly on the plane: belongs to neither side.
    const across = g.dimension === 2 ? 1 : 2;
    const on = g.axisPlane(across, 0.5);
    expect(g.classifyFacet(on, f)).toBe(Side.On);
    expect(g.clipFacet(f, on)).toBeNull();
  });
});

/** A facet spanning x ∈ [0, 1] (2D: segment along y = 0.5; 3D: square in z = 0.5). */
describe.each(kernels)("%s portalFrustum", (_, g) => {
  // spanning(): on y = 0.5 (2D) / z = 0.5 (3D), x and the other axis in [0, 1].
  const pt = (x: number, h: number) => (g.dimension === 2 ? { x, y: h } : { x, y: 0.5, z: h });
  it("contains the cone beyond the facet, excludes points beside it, null when edge-on", () => {
    const planes = g.portalFrustum(pt(0.5, 0), spanning(g))!;
    expect(planes).toHaveLength(g.dimension === 2 ? 2 : 4);
    const inside = (p: unknown) => planes.every((pl) => g.signedDistance(pl, p) > 0);
    expect(inside(pt(0.5, 2))).toBe(true);
    expect(inside(pt(0.9, 0.6))).toBe(true);
    expect(inside(pt(3, 2))).toBe(false);
    expect(inside(pt(-2, 2))).toBe(false);
    expect(g.portalFrustum(pt(5, 0.5), spanning(g))).toBeNull();
  });
});

function spanning(g: Geometry<Dim>): unknown {
  if (g.dimension === 2) return { a: { x: 0, y: 0.5 }, b: { x: 1, y: 0.5 } };
  return [{ x: 0, y: 0, z: 0.5 }, { x: 1, y: 0, z: 0.5 }, { x: 1, y: 1, z: 0.5 }, { x: 0, y: 1, z: 0.5 }];
}
