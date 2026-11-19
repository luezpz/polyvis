/**
 * Runtime portal clipping (optimization plan phase 4; Doom 3 portal areas, Teller's eye-to-cell
 * visibility): the leaves visible from an actual eye point, with the baked PVS as a prefilter.
 *
 * Depth-first from the camera leaf through open portals that face the eye. Two clip modes:
 *
 * - `"planes"` (precise): the portal winding is clipped to the current frustum; if something
 *   remains, `p.to` is visible and the search continues with the cone from the eye through the
 *   clipped winding (`Geometry.portalFrustum`). Clipping the winding instead of intersecting
 *   frusta keeps every frustum a plain plane list.
 * - `"rect"` (cheap, Doom 3): the winding is projected to a screen rectangle (`projectRect`) and
 *   intersected with the current one. A box per portal instead of a polygon clip; looser
 *   (rects over-cover oblique / non-rectangular openings) and limited to the view's half space.
 *
 * A leaf may be reached along several paths, each with its own frustum / rect, so leaves are not
 * "visited once". Two cuts keep this from blowing up (3D Pillar forest hung without the second):
 * re-entering a leaf already on the current path (a straight sight line cannot leave and re-enter
 * a convex leaf), and entering a leaf with a frustum / rect contained in one it was already entered
 * with (subsumed: every frustum has its apex at the eye, so the bigger one already explored every
 * sight line of the smaller). Planes: cone(w) ⊆ cone F ⇔ every vertex of w is inside F's planes.
 *
 * Conservative w.r.t. the eye: every leaf a sight line from `eye` inside the camera view reaches
 * is marked, since that line crosses a chain of portals each inside the narrowed frustum / rect.
 */

import type { Dim, Geometry, Plane, Vec } from "../geometry";
import { PLANE_EPSILON } from "../math";
import type { PortalGraph } from "../portals";
import { BitSet } from "../vis/bitset";
import { type ScreenRect, type View, axisViews, fullRect, intersectRects, projectRect, viewFrustum } from "./view";

export type ClipMode = "planes" | "rect";

export interface VisibleLeavesOptions<D extends Dim> {
  /** `"planes"` (precise, default) or `"rect"` (cheap screen rectangles; without `view`: cube map of 90° views). */
  readonly clip?: ClipMode;
  /** Camera; without it the query looks everywhere (omnidirectional: probes, light reach). */
  readonly view?: View<D>;
  /** Extra / explicit frustum planes for "planes" mode (front = inside); default: `view`'s sides. */
  readonly frustum?: readonly Plane<D>[];
  /** PVS row of the camera leaf (bit = leaf); leaves outside it are never entered. Null = no prefilter. */
  readonly pvsRow?: BitSet | null;
  /** `portalOpen[p]` falsy = closed (door); missing = every portal open. */
  readonly portalOpen?: ArrayLike<boolean | number>;
  /** Bench counters (optional, accumulated): `crossings` = portals passed, summed over all paths (blowup check). */
  readonly stats?: { crossings: number };
}

/**
 * Leaves visible from `eye` in leaf `cameraLeaf` (bit per leaf, camera leaf included).
 * `g`: kernel; `graph`: the compiled portal graph. Cost: one clip (or rect) per portal crossing per path.
 */
export function visibleLeaves<D extends Dim>(
  g: Geometry<D>, graph: PortalGraph<D>, cameraLeaf: number, eye: Vec<D>, opts: VisibleLeavesOptions<D> = {},
): BitSet {
  const { pvsRow = null, portalOpen, view, clip = "planes", stats } = opts;
  const seen = new BitSet(graph.leafCount);
  const onPath = new Uint8Array(graph.leafCount);
  seen.set(cameraLeaf);
  /** Frusta (planes mode) or rects (rect mode) each leaf was entered with, for the subsumption cut. */
  const entered: (readonly unknown[])[] = [];
  /** Records `shape` for `leaf` unless an earlier entry contains it (`inside(prev)`); false = skip. */
  const enter = <S>(leaf: number, shape: S, inside: (prev: S) => boolean): boolean => {
    const list = (entered[leaf] ??= []) as S[];
    for (const prev of list) if (inside(prev)) return false;
    list.push(shape);
    return true;
  };

  /** Portals out of `leaf` worth trying: open, in the PVS, not re-entering the path, facing the eye. */
  const candidates = function* (leaf: number) {
    for (const pid of graph.portalsFrom[leaf]) {
      const p = graph.portals[pid];
      if (onPath[p.to] || (portalOpen && !portalOpen[pid]) || (pvsRow && !pvsRow.has(p.to))) continue;
      // The eye must be behind the portal (normal points into `to`): we look through it, not back.
      if (g.signedDistance(p.plane, eye) >= 0) continue;
      yield p;
    }
  };

  if (clip === "rect" && !view) {
    // Omnidirectional rect mode: union over a cube map of 90° views.
    for (const v of axisViews(g)) seen.orWith(visibleLeaves(g, graph, cameraLeaf, eye, { ...opts, view: v }));
    return seen;
  }
  if (clip === "rect" && view) {
    const visit = (leaf: number, rect: ScreenRect): void => {
      onPath[leaf] = 1;
      for (const p of candidates(leaf)) {
        const pr = projectRect(g, eye, view, g.facetPoints(p.winding));
        if (!pr) continue;
        const next = pr === "all" ? rect : intersectRects(rect, pr);
        if (!next) continue;
        seen.set(p.to);
        if (!enter(p.to, next, (q) => next.min.every((x, i) => x >= q.min[i] && next.max[i] <= q.max[i]))) continue;
        if (stats) stats.crossings++;
        visit(p.to, next);
      }
      onPath[leaf] = 0;
    };
    visit(cameraLeaf, view.rect ?? fullRect(view.axes.length));
    return seen;
  }

  const visit = (leaf: number, planes: readonly Plane<D>[]): void => {
    onPath[leaf] = 1;
    for (const p of candidates(leaf)) {
      const w = g.clipFacetToPlanes(p.winding, planes);
      if (!w) continue;
      const next = g.portalFrustum(eye, w);
      if (!next) continue;
      seen.set(p.to);
      const pts = g.facetPoints(w);
      if (!enter(p.to, next, (f) => pts.every((v) => f.every((pl) => g.signedDistance(pl, v) >= -PLANE_EPSILON)))) continue;
      if (stats) stats.crossings++;
      visit(p.to, next);
    }
    onPath[leaf] = 0;
  };
  visit(cameraLeaf, [...(view ? viewFrustum(g, eye, view) : []), ...(opts.frustum ?? [])]);
  return seen;
}
