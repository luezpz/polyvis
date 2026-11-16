/**
 * Flat numeric encodings of 2D facets and cells (the `pack*` / `unpack*` ops
 * of `geometry2`): a `Float64Array` of them crosses a worker boundary as a
 * memcpy, where cloning the object graph costs a lot more.
 *
 * Segment: `ax ay bx by`. Polygon: `n`, then `x y tag` per vertex (tag of the edge leaving it).
 */

import type { ConvexPolygon, Segment, Vec2 } from "./math";

/** Appends `s` to `out`. */
export function packSegment(s: Segment, out: number[]): void {
  out.push(s.a.x, s.a.y, s.b.x, s.b.y);
}

/** Reads a segment written by {@link packSegment} at `data[at]`; returns it and the index after it. */
export function unpackSegment(data: ArrayLike<number>, at: number): [Segment, number] {
  return [{ a: { x: data[at], y: data[at + 1] }, b: { x: data[at + 2], y: data[at + 3] } }, at + 4];
}

/** Appends `p` to `out`. */
export function packPolygon(p: ConvexPolygon, out: number[]): void {
  out.push(p.vertices.length);
  p.vertices.forEach((v, i) => out.push(v.x, v.y, p.tags[i]));
}

/** Reads a polygon written by {@link packPolygon} at `data[at]`; returns it and the index after it. */
export function unpackPolygon(data: ArrayLike<number>, at: number): [ConvexPolygon, number] {
  const n = data[at++];
  const vertices: Vec2[] = new Array(n);
  const tags: number[] = new Array(n);
  for (let i = 0; i < n; i++, at += 3) {
    vertices[i] = { x: data[at], y: data[at + 1] };
    tags[i] = data[at + 2];
  }
  return [{ vertices, tags }, at];
}
