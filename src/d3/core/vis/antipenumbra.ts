/**
 * Antipenumbra (separating-plane) construction and clipping, 3D version.
 *
 * Given a *source* portal S and a *pass* portal P, every sight line that
 * starts on S and goes through P stays inside the region bounded by the
 * *separating planes* of S and P (Teller 1992; Golodetz 2009, Listing 2;
 * Quake `vis` ClipToSeperators): planes through an **edge of one portal and a
 * vertex of the other** such that the two portals lie on opposite sides.
 * Candidates are built in both directions (edges of S × vertices of P, and
 * edges of P × vertices of S); in 2D both collapse to endpoint × endpoint.
 *
 * Each separator is oriented so that P (and therefore everything beyond P as
 * seen from S) is in front. Anything that should be visible from S through P
 * must be in front of every separator; clipping a third portal to them is the
 * antipenumbra test. If the portals share vertices or edges there are fewer
 * separators and the region is larger (still conservative).
 */

import { type Plane3, type Winding, clipWinding, PLANE_EPSILON, SEPARATOR_SIN_EPSILON } from "../math";

/** Copied once: imports are getters under Vite's module runner. */
const SIN_EPS_SQ = SEPARATOR_SIN_EPSILON * SEPARATOR_SIN_EPSILON;

/**
 * Builds the separating planes between `from` and `to`, oriented so that `to`
 * (and the region beyond it, as seen from `from`) is in front and `from` is
 * behind.
 */
export function buildSeparators(from: Winding, to: Winding, eps = PLANE_EPSILON): Plane3[] {
  const out: Plane3[] = [];
  const collect = (p: Plane3) => { out.push(p); return true; };
  forEachSeparator(from, to, true, eps, collect) && forEachSeparator(to, from, false, eps, collect);
  return out;
}

/** Clips a winding to the front of every plane in order; null as soon as it vanishes. */
export function clipToPlanes(w: Winding, planes: readonly Plane3[], eps = PLANE_EPSILON): Winding | null {
  let cur: Winding | null = w;
  for (const p of planes) if (!(cur = clipWinding(cur, p, eps))) return null;
  return cur;
}

/**
 * Clips `target` to the front of every separator of (`from`, `to`), as the
 * separators are found, stopping as soon as nothing is left (Quake's
 * ClipToSeperators). Equivalent to clipping by {@link buildSeparators} but
 * much cheaper when the target gets clipped away early.
 */
export function clipToSeparators(from: Winding, to: Winding, target: Winding, eps = PLANE_EPSILON): Winding | null {
  let cur: Winding | null = target;
  const clip = (p: Plane3) => (cur = clipWinding(cur!, p, eps)) !== null;
  forEachSeparator(from, to, true, eps, clip) && forEachSeparator(to, from, false, eps, clip);
  return cur;
}

/**
 * Visits the separators through edges of `owner` and vertices of `other`.
 * `ownerIsFrom` selects the orientation (owner behind if it is `from`, in
 * front if it is `to`). Stops (returning false) when `visit` returns false.
 */
function forEachSeparator(owner: Winding, other: Winding, ownerIsFrom: boolean, eps: number, visit: (p: Plane3) => boolean): boolean {
  // Hot loop of the whole compiler: plain arithmetic, no temporaries.
  const n = owner.length;
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const a = owner[i], b = owner[i1];
    const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
    const eLenSq = ex * ex + ey * ey + ez * ez;
    for (const v of other) {
      const vx = v.x - a.x, vy = v.y - a.y, vz = v.z - a.z;
      let nx = ey * vz - ez * vy, ny = ez * vx - ex * vz, nz = ex * vy - ey * vx;
      // Scale-free: |e × v|² < sin²·|e|²·|v|² means v lies on the edge's line (shared vertex / collinear).
      const lenSq = nx * nx + ny * ny + nz * nz;
      if (lenSq < SIN_EPS_SQ * eLenSq * (vx * vx + vy * vy + vz * vz) || lenSq === 0) continue;
      const len = Math.sqrt(lenSq);
      nx /= len; ny /= len; nz /= len;
      const d = nx * a.x + ny * a.y + nz * a.z;

      // Which side is the owner on? (Convex and planar: all its other vertices are on one side.)
      let ownerSide = 0;
      for (let k = 0; k < n; k++) {
        if (k === i || k === i1) continue;
        const q = owner[k];
        const s = nx * q.x + ny * q.y + nz * q.z - d;
        if (s > eps) { ownerSide = 1; break; }
        if (s < -eps) { ownerSide = -1; break; }
      }
      if (ownerSide === 0) continue; // plane contains the owner portal: not a separator

      // The other portal must lie entirely on the opposite side (touching allowed), not all on the plane.
      let ok = true, strict = false;
      for (const q of other) {
        const s = (nx * q.x + ny * q.y + nz * q.z - d) * -ownerSide;
        if (s < -eps) { ok = false; break; }
        if (s > eps) strict = true;
      }
      if (!ok || !strict) continue;

      // Orient: `from` behind, `to` in front.
      const flip = ownerIsFrom ? ownerSide > 0 : ownerSide < 0;
      const plane: Plane3 = flip ? { n: { x: -nx, y: -ny, z: -nz }, d: -d } : { n: { x: nx, y: ny, z: nz }, d };
      if (!visit(plane)) return false;
    }
  }
  return true;
}
