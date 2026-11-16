/**
 * Flat numeric encodings of 3D facets and cells (the `pack*` / `unpack*` ops
 * of `geometry3`): a `Float64Array` of them crosses a worker boundary as a
 * memcpy, where cloning the object graph costs a lot more.
 *
 * Winding: `n`, then `x y z` per vertex. Polyhedron: face count, then per
 * face `nx ny nz d tag` and its winding.
 */

import type { ConvexPolyhedron, PolyFace, Vec3, Winding } from "./math";

/** Appends `w` to `out`. */
export function packWinding(w: Winding, out: number[]): void {
  out.push(w.length);
  for (const v of w) out.push(v.x, v.y, v.z);
}

/** Reads a winding written by {@link packWinding} at `data[at]`; returns it and the index after it. */
export function unpackWinding(data: ArrayLike<number>, at: number): [Winding, number] {
  const n = data[at++];
  const w: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++, at += 3) w[i] = { x: data[at], y: data[at + 1], z: data[at + 2] };
  return [w, at];
}

/** Appends `p` to `out`. */
export function packPolyhedron(p: ConvexPolyhedron, out: number[]): void {
  out.push(p.faces.length);
  for (const f of p.faces) {
    out.push(f.plane.n.x, f.plane.n.y, f.plane.n.z, f.plane.d, f.tag);
    packWinding(f.winding, out);
  }
}

/** Reads a polyhedron written by {@link packPolyhedron} at `data[at]`; returns it and the index after it. */
export function unpackPolyhedron(data: ArrayLike<number>, at: number): [ConvexPolyhedron, number] {
  const n = data[at++];
  const faces: PolyFace[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const plane = { n: { x: data[at], y: data[at + 1], z: data[at + 2] }, d: data[at + 3] };
    const tag = data[at + 4];
    const [winding, next] = unpackWinding(data, at + 5);
    faces[i] = { plane, winding, tag };
    at = next;
  }
  return [{ faces }, at];
}
