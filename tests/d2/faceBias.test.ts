import { describe, expect, it } from "vitest";
import { compileLevel } from "../../src/d2/core";
import { EditorModel } from "../../src/d2/app/editor/model";

/** Model with one square brush selected. */
function boxModel(kind: "room" | "solid" = "solid"): { model: EditorModel; id: number } {
  const model = new EditorModel();
  const id = model.addBrush(kind, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }])!;
  return { model, id };
}

describe("editor edge split bias", () => {
  it("selects an edge and resets it when the brush selection changes", () => {
    const { model, id } = boxModel();
    model.selectFace(2);
    expect(model.selectedFace).toBe(2);
    model.select(null);
    model.select(id);
    expect(model.selectedFace).toBe(-1);
  });

  it("keeps biases across kind / flag / move edits and duplication (regression: updateBrush dropped them)", () => {
    const { model, id } = boxModel();
    model.setFaceSplitBias(id, 1, -30);
    const before = model.selectedBrush!.faceSplitBias;
    model.updateBrush(id, { kind: "room" });
    model.updateBrush(id, { kind: "solid", detail: true });
    model.translateBrush(id, model.selectedBrush!, { x: 1, y: 1 });
    expect(model.selectedBrush!.faceSplitBias).toEqual(before);
    model.duplicateBrush(id, { x: 10, y: 0 });
    expect(model.selectedId).not.toBe(id);
    expect(model.selectedBrush!.faceSplitBias).toEqual(before);
    expect(model.selectedBrush!.detail).toBe(true);
  });

  it("clearing the last bias removes the field; edits are undoable", () => {
    const { model, id } = boxModel();
    model.setFaceSplitBias(id, 0, 5);
    model.setFaceSplitBias(id, 0, 0);
    expect(model.selectedBrush!.faceSplitBias).toBeUndefined();
    model.undo();
    expect(model.selectedBrush!.faceSplitBias?.[0]).toBe(5);
  });

  it("an edited bias reaches the compiled walls", () => {
    const { model, id } = boxModel("room");
    model.setFaceSplitBias(id, 0, -1000);
    expect(compileLevel(model.level).walls.some((w) => w.splitBias === -1000)).toBe(true);
  });
});
