/**
 * Walls from imported meshes (no CSG): every mesh face becomes a wall as-is,
 * with empty space in front. The result may leak; the compiler reports that.
 */

import type { ImportedMesh } from "../level";
import { type Wall, makeWall } from "./walls";

/** Wall `sourceId`s of mesh faces are `-meshId` so they can be told apart from brush ids. */
export function buildMeshWalls(meshes: readonly ImportedMesh[]): Wall[] {
  return meshes.flatMap((m) => m.faces.flatMap((f) => makeWall(f, -m.id) ?? []));
}
