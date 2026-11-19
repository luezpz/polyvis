/**
 * The seam between the dimension-agnostic compiler stages and the 2D / 3D
 * geometry kernels.
 *
 * Every stage after CSG (BSP build and refinement, leaf surfaces, leak
 * detection, base vis, portal flow, leaf PVS) is the same algorithm in 2D and
 * 3D; only the primitives differ. Those stages live in `src/shared/core` and
 * are written against {@link Geometry}, which each dimension implements once
 * (`src/d2/core/geometry.ts`, `src/d3/core/geometry.ts`):
 *
 * | concept | 2D              | 3D                 |
 * |---------|-----------------|--------------------|
 * | vec     | `Vec2`          | `Vec3`             |
 * | plane   | `Line2`         | `Plane3`           |
 * | facet   | `Segment`       | `Winding`          |
 * | cell    | `ConvexPolygon` | `ConvexPolyhedron` |
 *
 * A *facet* is a convex piece of a plane (walls, portals, leaf surfaces); a
 * *cell* is a convex region of space whose boundary pieces carry tags (BSP
 * node and leaf regions). Both dimensions use the same field names for these
 * (`winding`, `plane`, `region`), so code reads the same on either side.
 *
 * An idea prototyped in a shared stage therefore works in both dimensions at
 * once; only new *geometric* primitives need a 2D and a 3D implementation.
 */

import type { Side } from "./math";

/** Oriented plane in Hessian normal form: points `p` with `dot(n, p) = d`; `n` is unit and points to the front. */
export interface Hyperplane<V> {
  readonly n: V;
  readonly d: number;
}

/** Axis-aligned bounding box. */
export interface Box<V> {
  readonly min: V;
  readonly max: V;
}

/** The primitive types of one dimension (see the table in the module docs). */
export interface Dim<V = unknown, F = unknown, C = unknown> {
  readonly vec: V;
  readonly facet: F;
  readonly cell: C;
}

export type Vec<D extends Dim> = D["vec"];
export type Plane<D extends Dim> = Hyperplane<D["vec"]>;
export type Facet<D extends Dim> = D["facet"];
export type Cell<D extends Dim> = D["cell"];
export type Bounds<D extends Dim> = Box<D["vec"]>;

/**
 * Geometric operations the shared stages need. All functions are pure, use
 * the tolerances of `math/tolerance.ts`, and must not depend on `this` (hot
 * loops destructure them).
 */
export interface Geometry<D extends Dim> {
  /** Number of coordinate axes (2 or 3). */
  readonly dimension: number;
  /** The origin. */
  readonly zero: Vec<D>;

  dot(a: Vec<D>, b: Vec<D>): number;
  /** Components of `v`, one per axis (`[x, y]` or `[x, y, z]`). */
  coords(v: Vec<D>): number[];
  /** The vector whose components are `data[at .. at + dimension)` (inverse of `coords`). */
  vecAt(data: ArrayLike<number>, at: number): Vec<D>;

  /** Signed distance of `p` from `plane`: positive in front. */
  signedDistance(plane: Plane<D>, p: Vec<D>): number;
  /** Same plane, opposite orientation. */
  flipPlane(plane: Plane<D>): Plane<D>;
  /** True if `a` and `b` are the same plane with the same orientation. */
  sameOrientedPlane(a: Plane<D>, b: Plane<D>): boolean;
  /** The plane `coordinate[axis] = d`, facing the positive axis direction. */
  axisPlane(axis: number, d: number): Plane<D>;

  /** Bounding box of a point set, or null if it is empty. */
  boundsOf(points: Iterable<Vec<D>>): Bounds<D> | null;
  /** `box` grown by `margin` on every side. */
  expandBounds(box: Bounds<D>, margin: number): Bounds<D>;
  /** True if the boxes overlap or come within `eps` of each other. */
  boundsOverlap(a: Bounds<D>, b: Bounds<D>, eps: number): boolean;

  /** Vertices of a facet. */
  facetPoints(facet: Facet<D>): readonly Vec<D>[];
  /** Size of a facet: 2D segment length, 3D winding area (cluster "wide portal" test). */
  facetMeasure(facet: Facet<D>): number;
  /** Front / Back / On / Spanning. */
  classifyFacet(plane: Plane<D>, facet: Facet<D>): Side;
  /**
   * The part of `facet` in front of `plane`. Unchanged (same object) if fully
   * in front; null if behind, lying on the plane, or degenerate after clipping.
   */
  clipFacet(facet: Facet<D>, plane: Plane<D>): Facet<D> | null;

  /** The box as a cell with every boundary piece tagged `tag`. */
  cellFromBounds(box: Bounds<D>, tag: number): Cell<D>;
  /**
   * The part of `cell` in front of `plane`; the new boundary piece on the
   * plane is tagged `tag`, the others keep theirs. Null if nothing (or only a
   * degenerate sliver) remains.
   */
  clipCell(cell: Cell<D>, plane: Plane<D>, tag: number): Cell<D> | null;
  /** Corner points of a cell (repeats allowed). */
  cellVertices(cell: Cell<D>): readonly Vec<D>[];
  /** True if any boundary piece of `cell` carries `tag`. */
  cellHasTag(cell: Cell<D>, tag: number): boolean;
  /**
   * Flat numeric encodings, so facets and cells cross worker boundaries as a
   * `Float64Array` (a memcpy) instead of a costly object-graph clone. `pack*`
   * appends to `out`; `unpack*` reads at `data[at]` and returns the value and
   * the index just past it.
   */
  packFacet(facet: Facet<D>, out: number[]): void;
  unpackFacet(data: ArrayLike<number>, at: number): [Facet<D>, number];
  packCell(cell: Cell<D>, out: number[]): void;
  unpackCell(data: ArrayLike<number>, at: number): [Cell<D>, number];
  /** The same cell with every boundary tag `t` replaced by `map(t)` (parallel BSP merge renumbers planes). */
  retagCell(cell: Cell<D>, map: (tag: number) => number): Cell<D>;

  /**
   * True if wall facet `wall` touches the closure of empty-leaf region `cell`
   * (corner-split candidate test of `bsp/refine.ts`).
   */
  wallTouchesCell(wall: Facet<D>, cell: Cell<D>): boolean;

  /**
   * Antipenumbra clip: the part of `target` in front of every separating
   * plane of (`from`, `to`), i.e. what can be seen from `from` through `to`.
   * Null if nothing is left.
   */
  clipToSeparators(from: Facet<D>, to: Facet<D>, target: Facet<D>): Facet<D> | null;
  /**
   * The separating planes of (`from`, `to`), in the order `clipToSeparators` visits them, so
   * `clipFacetToPlanes(t, separators(f, p))` equals `clipToSeparators(f, p, t)` exactly. Lets the
   * flow build them once per (source, pass) frame (phase 1b).
   */
  separators(from: Facet<D>, to: Facet<D>): Plane<D>[];
  /** `facet` clipped to the front of every plane in order (`clipFacet` each); null once it vanishes. */
  clipFacetToPlanes(facet: Facet<D>, planes: readonly Plane<D>[]): Facet<D> | null;
}
