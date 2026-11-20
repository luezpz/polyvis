import { describe, expect, it } from "vitest";
import { compileLevel } from "../../src/d3/core";
import { EditorModel } from "../../src/d3/app/editor/model";

/** Model with one solid box selected. */
function boxModel(): { model: EditorModel; id: number } {
  const model = new EditorModel();
  const id = model.addBox("solid", { x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 })!;
  return { model, id };
}

describe("editor face split bias", () => {
  it("selects a face and resets it when the brush selection changes", () => {
    const { model, id } = boxModel();
    expect(model.selectedFace).toBe(-1);
    model.selectFace(3);
    expect(model.selectedFace).toBe(3);
    model.select(null);
    model.select(id);
    expect(model.selectedFace).toBe(-1);
  });

  it("sets one face's bias as an undoable edit and keeps it across geometry edits", () => {
    const { model, id } = boxModel();
    model.setFaceSplitBias(id, 2, -50);
    expect(model.selectedBrush!.faceSplitBias).toEqual([0, 0, -50, 0, 0, 0]);
    const normal = model.selectedBrush!.planes[2].n;
    model.moveFace(id, model.selectedBrush!, 0, 1);
    model.setKind(id, "room");
    const b = model.selectedBrush!;
    const j = b.planes.findIndex((p) => p.n.x === normal.x && p.n.y === normal.y && p.n.z === normal.z);
    expect(b.faceSplitBias?.[j]).toBe(-50);
    model.undo();
    model.undo();
    model.undo();
    expect(model.selectedBrush!.faceSplitBias).toBeUndefined();
  });

  it("clearing the last bias removes the field; non-finite values are ignored", () => {
    const { model, id } = boxModel();
    model.setFaceSplitBias(id, 1, 7);
    model.setFaceSplitBias(id, 1, Number.NaN);
    expect(model.selectedBrush!.faceSplitBias?.[1]).toBe(7);
    model.setFaceSplitBias(id, 1, 0);
    expect(model.selectedBrush!.faceSplitBias).toBeUndefined();
  });

  it("an edited bias reaches the compiled walls", () => {
    const model = new EditorModel();
    const id = model.addBox("room", { x: 0, y: 0, z: 0 }, { x: 4, y: 4, z: 4 })!;
    model.setFaceSplitBias(id, 0, -1000);
    expect(compileLevel(model.level).walls.some((w) => w.splitBias === -1000)).toBe(true);
  });
});
