/**
 * 3D view frustum through a portal winding (phase 4 runtime clipping; Doom 3 portal areas):
 * one plane per winding edge through the eye, facing the winding's centroid.
 */

import { type Plane3, type Vec3, type Winding, PLANE_EPSILON } from "../math";

/**
 * Planes from `eye` through each edge of convex `w` (front = inside the frustum). Plane through
 * e, a, b: n = normalize((a − e) × (b − e)), d = n·e. Null if the eye is (nearly) on w's plane.
 */
export function portalFrustum3(eye: Vec3, w: Winding): Plane3[] | null {
  const k = w.length;
  let cx = 0, cy = 0, cz = 0;
  for (const v of w) { cx += v.x; cy += v.y; cz += v.z; }
  cx /= k; cy /= k; cz /= k;
  const out: Plane3[] = [];
  for (let i = 0; i < k; i++) {
    const a = w[i], b = w[(i + 1) % k];
    const ax = a.x - eye.x, ay = a.y - eye.y, az = a.z - eye.z;
    const bx = b.x - eye.x, by = b.y - eye.y, bz = b.z - eye.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-10) continue; // eye on the edge's line: neighbouring planes still bound the cone
    nx /= len; ny /= len; nz /= len;
    const d = nx * eye.x + ny * eye.y + nz * eye.z;
    const s = nx * cx + ny * cy + nz * cz - d;
    if (Math.abs(s) <= PLANE_EPSILON) return null; // eye on the winding's plane
    out.push(s > 0 ? { n: { x: nx, y: ny, z: nz }, d } : { n: { x: -nx, y: -ny, z: -nz }, d: -d });
  }
  return out.length >= 3 ? out : null;
}
