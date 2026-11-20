/**
 * OBJ import → level parts: the mesh (with hint biases) and door brushes from `door_<name>` volumes.
 * Shared by the editor, the bench and tests so an OBJ means the same level everywhere.
 */

import { type Brush, type ImportedMesh, type Level, LEVEL_FORMAT, LEVEL_VERSION, makeBrush, withDoor } from "../level";
import type { ObjImportResult } from "./obj";

/**
 * Door brushes (solid, `door` = name) for `doors`, ids from `firstId` up.
 * @returns the brushes, and the names whose planes enclose no bounded volume (skipped).
 */
export function objDoorBrushes(doors: ObjImportResult["doors"], firstId: number): { brushes: Brush[]; failed: string[] } {
  const brushes: Brush[] = [], failed: string[] = [];
  for (const d of doors) {
    const b = makeBrush(firstId + brushes.length, "solid", d.planes);
    if (b) brushes.push(withDoor(b, d.name));
    else failed.push(d.name);
  }
  return { brushes, failed };
}

/** `obj` as an {@link ImportedMesh} with id `id` and name `name`. */
export function objMesh(obj: ObjImportResult, id: number, name: string): ImportedMesh {
  return { id, name, faces: obj.faces, ...(obj.faceSplitBias ? { faceSplitBias: obj.faceSplitBias } : {}) };
}

/** A whole level from one OBJ: its mesh plus its door brushes (`failed`: doors with no volume). */
export function levelFromObj(obj: ObjImportResult, name = "obj"): { level: Level; failed: string[] } {
  const { brushes, failed } = objDoorBrushes(obj.doors, 1);
  return { level: { format: LEVEL_FORMAT, version: LEVEL_VERSION, brushes, meshes: [objMesh(obj, 1, name)] }, failed };
}
