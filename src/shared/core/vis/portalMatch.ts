/**
 * Matching portals across two compiles of an edited level (phase 3.5), for exact row reuse
 * (`incrementalFlow.ts`, `incrementalBaseVis.ts`). Two portals match iff their plane and winding
 * numbers are identical (which also fixes the direction), so any per-portal geometric test gives
 * the same verdict on both. Leaf ids are not stable across compiles; callers relate leaves through
 * matched portals with a {@link LeafBinder}.
 */

import type { Dim, Geometry } from "../geometry";
import type { PortalGraph } from "../portals";
import { BitSet } from "./bitset";

/** Exact identity of a directed portal: plane `n, d` and winding numbers (`packFacet`), round-trip exact. */
export function portalKey<D extends Dim>(g: Geometry<D>, plane: { readonly n: D["vec"]; readonly d: number }, winding: D["facet"]): string {
  const out: number[] = [...g.coords(plane.n), plane.d];
  g.packFacet(winding, out);
  return out.join(",");
}

/** Key → id for every portal of `graph`; keys shared by several portals are left out (never matched). */
export function portalKeyIds<D extends Dim>(g: Geometry<D>, graph: PortalGraph<D>): Map<string, number> {
  const ids = new Map<string, number>();
  const dup = new Set<string>();
  for (const p of graph.portals) {
    const k = portalKey(g, p.plane, p.winding);
    if (ids.has(k)) dup.add(k);
    ids.set(k, p.id);
  }
  for (const k of dup) ids.delete(k);
  return ids;
}

/** A one-to-one matching between new portals (`n`) and old portals (`oldCount`). */
export interface PortalMatch {
  /** `match[new id]` = old id, or -1. */
  readonly match: Int32Array;
  /** `toNew[old id]` = new id, or -1. */
  readonly toNew: Int32Array;
  /** An old row in new ids; unmatched old bits are dropped (compare counts to detect them). */
  remap(row: BitSet): BitSet;
}

/** Matches portals by key (`portalKeyIds` of both graphs). Injective since keys are unique per side. */
export function matchPortals(ids: ReadonlyMap<string, number>, n: number, oldIds: ReadonlyMap<string, number>, oldCount: number): PortalMatch {
  const match = new Int32Array(n).fill(-1);
  const toNew = new Int32Array(oldCount).fill(-1);
  for (const [k, id] of ids) {
    const o = oldIds.get(k);
    if (o !== undefined) (match[id] = o), (toNew[o] = id);
  }
  const remap = (row: BitSet): BitSet => {
    const out = new BitSet(n);
    for (const o of row.toArray()) if (toNew[o] >= 0) out.set(toNew[o]);
    return out;
  };
  return { match, toNew, remap };
}

/** A partial bijection new leaf ↔ old leaf, built up by {@link LeafBinder.bind} and reset per check. */
export class LeafBinder {
  private readonly toOld = new Map<number, number>();
  private readonly toNew = new Map<number, number>();

  reset(): void {
    this.toOld.clear();
    this.toNew.clear();
  }

  /** Relates new leaf `a` to old leaf `b`; false if either is already related to another leaf. */
  bind(a: number, b: number): boolean {
    const x = this.toOld.get(a), y = this.toNew.get(b);
    if (x === undefined && y === undefined) {
      this.toOld.set(a, b);
      this.toNew.set(b, a);
      return true;
    }
    return x === b && y === a;
  }

  /** Old leaf bound to new leaf `a`, or undefined. */
  oldOf(a: number): number | undefined {
    return this.toOld.get(a);
  }

  /** New leaf bound to old leaf `b`, or undefined. */
  newOf(b: number): number | undefined {
    return this.toNew.get(b);
  }
}
