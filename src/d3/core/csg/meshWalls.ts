/**
 * Walls from imported meshes (no CSG): every mesh face becomes a wall as-is,
 * with empty space in front. The result may leak; the compiler reports that.
 */

import type { ImportedMesh } from "../level";
import { type Wall, makeWall } from "./walls";

/**
 * Wall `sourceId`s of mesh faces are `-meshId` so they can be told apart from brush ids.
 * A face's `faceSplitBias` (phase 3d hint faces) becomes its wall's `splitBias`.
 */
export function buildMeshWalls(meshes: readonly ImportedMesh[]): Wall[] {
  return meshes.flatMap((m) => m.faces.flatMap((f, i) => makeWall(f, -m.id, undefined, m.faceSplitBias?.[i] ?? 0) ?? []));
}
