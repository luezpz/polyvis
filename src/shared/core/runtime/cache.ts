/**
 * Runtime coherence (optimization plan phase 4 leftover): reuse portal-clipping results across frames.
 *
 * Exact, not approximate: a cached result is returned only when a fresh query would compute the same
 * bits. `visibleLeaves` is a deterministic function of (graph, leaf, eye, clip, view, frustum, pvsRow)
 * and of `portalOpen` only at the portals it read (`readPortals`). So an entry stores its inputs by value
 * plus a snapshot of those door flags, and hits iff all are equal. Typical hits: a still camera, several
 * passes per frame (shadow / reflection views with the same eye), and static lights, which stay cached
 * across door toggles that their traversal never reached. A moving camera simply misses (one compare).
 *
 * Results are shared between hits: callers must not mutate the returned `BitSet` / array.
 */

import type { BspTree } from "../bsp";
import type { Dim, Geometry, Plane, Vec } from "../geometry";
import type { PortalGraph } from "../portals";
import type { BitSet } from "../vis/bitset";
import { type LightOptions, lightLeaves } from "./culling";
import type { View } from "./view";
import { type VisibleLeavesOptions, visibleLeaves } from "./visibleLeaves";

/** Door flags a result depends on: portal ids and their `portalOpen` truthiness at query time. */
interface DoorSnapshot {
  readonly ids: Int32Array;
  readonly open: Uint8Array;
}

const snapshot = (read: Set<number>, portalOpen: ArrayLike<boolean | number> | undefined): DoorSnapshot => {
  const ids = Int32Array.from(read);
  const open = new Uint8Array(ids.length);
  if (portalOpen) for (let i = 0; i < ids.length; i++) open[i] = portalOpen[ids[i]] ? 1 : 0;
  return { ids, open };
};

/**
 * True if `portalOpen` still matches `s`. A missing `portalOpen` means "all open"; a snapshot taken
 * without one read nothing, so it only matches another missing one (checked by the caller via `hadDoors`).
 */
const doorsMatch = (s: DoorSnapshot, portalOpen: ArrayLike<boolean | number> | undefined): boolean => {
  if (!portalOpen) return true;
  const { ids, open } = s;
  for (let i = 0; i < ids.length; i++) if ((portalOpen[ids[i]] ? 1 : 0) !== open[i]) return false;
  return true;
};

const sameNums = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Flattened numbers of everything a query's geometry depends on (eye, view, frustum), for by-value compares. */
function queryKey<D extends Dim>(g: Geometry<D>, eye: Vec<D>, view: View<D> | undefined, frustum: readonly Plane<D>[] | undefined): number[] {
  const out = g.coords(eye);
  if (view) {
    out.push(1, ...g.coords(view.forward));
    for (const a of view.axes) out.push(...g.coords(a));
    if (view.rect) out.push(1, ...view.rect.min, ...view.rect.max);
    else out.push(0);
  } else out.push(0);
  if (frustum) {
    out.push(frustum.length);
    for (const p of frustum) out.push(...g.coords(p.n), p.d);
  } else out.push(-1);
  return out;
}

interface Entry<R> {
  readonly leaf: number;
  readonly key: number[];
  readonly clip: string;
  readonly pvsRow: BitSet | null;
  readonly hadDoors: boolean;
  readonly doors: DoorSnapshot;
  readonly result: R;
}

const hit = <R>(e: Entry<R> | undefined, leaf: number, key: number[], clip: string, pvsRow: BitSet | null,
  portalOpen: ArrayLike<boolean | number> | undefined): e is Entry<R> =>
  !!e && e.leaf === leaf && e.clip === clip && e.pvsRow === pvsRow && e.hadDoors === !!portalOpen
  && sameNums(e.key, key) && doorsMatch(e.doors, portalOpen);

/** Hit / miss counters of a cache (for benches and tests). */
export interface CacheStats {
  hits: number;
  misses: number;
}

export interface VisCache<D extends Dim> {
  /**
   * `visibleLeaves(g, graph, leaf, eye, opts)`, reused from the last call with the same `slot` when
   * exact. `slot`: one entry per independent view (main camera, shadow pass, ...); default 0.
   * `pvsRow` is compared by identity (rows of a compile result are stable objects); `opts.readPortals` is ignored.
   */
  visible(leaf: number, eye: Vec<D>, opts?: VisibleLeavesOptions<D>, slot?: number): BitSet;
  /**
   * `lightLeaves` for light `id`, reused while its leaf, position, radius, PVS row and the door flags
   * its traversal read are unchanged (so a static light recomputes only when a door it reaches toggles).
   */
  light(id: number, leaf: number, pos: Vec<D>, radius: number, opts?: LightOptions<D>): readonly number[];
  /** Drops every entry (e.g. after a recompile replaced `graph` / `tree`). */
  clear(): void;
  readonly stats: CacheStats;
}

/**
 * A coherence cache over one compiled level (`graph`, `tree`; `g`: kernel). Entries are keyed by
 * slot / light id; each holds one result, so memory is O(slots + lights) results.
 */
export function createVisCache<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>, tree: BspTree<D>): VisCache<D> {
  const views = new Map<number, Entry<BitSet>>();
  const lights = new Map<number, Entry<readonly number[]>>();
  const stats: CacheStats = { hits: 0, misses: 0 };

  return {
    stats,
    visible(leaf, eye, opts = {}, slot = 0) {
      const { clip = "planes", pvsRow = null, portalOpen, view, frustum } = opts;
      const key = queryKey(g, eye, view, frustum);
      const e = views.get(slot);
      if (hit(e, leaf, key, clip, pvsRow, portalOpen)) { stats.hits++; return e.result; }
      stats.misses++;
      const read = new Set<number>();
      const result = visibleLeaves(g, graph, leaf, eye, { ...opts, readPortals: read });
      views.set(slot, { leaf, key, clip, pvsRow, hadDoors: !!portalOpen, doors: snapshot(read, portalOpen), result });
      return result;
    },
    light(id, leaf, pos, radius, opts = {}) {
      const { pvsRow = null, portalOpen } = opts;
      const key = [...g.coords(pos), radius];
      const e = lights.get(id);
      if (hit(e, leaf, key, "light", pvsRow, portalOpen)) { stats.hits++; return e.result; }
      stats.misses++;
      const read = new Set<number>();
      const result = lightLeaves(g, tree, graph, leaf, pos, radius, { pvsRow, portalOpen, readPortals: read });
      lights.set(id, { leaf, key, clip: "light", pvsRow, hadDoors: !!portalOpen, doors: snapshot(read, portalOpen), result });
      return result;
    },
    clear() { views.clear(); lights.clear(); },
  };
}
