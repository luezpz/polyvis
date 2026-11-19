import { describe, expect, it } from "vitest";
import { type CompileOptions, type Level, SAMPLE_LEVELS, compileLevel, compileSession, moveBrushFace } from "../../src/d3/core";

/** Level edits an editor makes: drop the last solid brush, push one face of the first solid. */
const edits: readonly [string, (l: Level) => Level][] = [
  ["remove a solid", (l) => {
    const i = l.brushes.map((b) => b.kind).lastIndexOf("solid");
    return i < 0 ? l : { ...l, brushes: l.brushes.filter((_, k) => k !== i) };
  }],
  ["move a face", (l) => ({ ...l, brushes: l.brushes.map((b, k) => (k === l.brushes.findIndex((x) => x.kind === "solid") ? (moveBrushFace(b, 0, 0.25) ?? b) : b)) })],
];

/** Option sets the session must handle: plain, vis on convex clusters, passages (flow reuse off). */
const modes: readonly Partial<CompileOptions>[] = [{}, { cluster: "convex" }, { baseVis: "passages" }];

const rows = (r: { portalVis: readonly { toHex(): string }[] }) => r.portalVis.map((v) => v.toHex());

describe("incremental base vis + flow (phase 3.5, 3D)", () => {
  for (const sample of SAMPLE_LEVELS) {
    it(`${sample.name}: a recompile reuses every source`, () => {
      const s = compileSession();
      const a = s.compileLevel(sample.create());
      const b = s.compileLevel(sample.create());
      expect(b.reused).toEqual({ bspNodes: b.result.tree.nodes.length, baseVis: b.result.graph.portals.length, flow: b.result.graph.portals.length });
      expect(rows(b.result)).toEqual(rows(a.result));
    });
    for (const [name, edit] of edits) for (const options of modes) {
      it(`${sample.name}: ${name} gives the fresh result (${JSON.stringify(options)})`, () => {
        const s = compileSession();
        s.compileLevel(sample.create(), options);
        const level = edit(sample.create());
        const inc = s.compileLevel(level, options).result;
        const fresh = compileLevel(level, options);
        expect(rows(inc)).toEqual(rows(fresh));
        expect(inc.mightSee.map((r) => r.toHex())).toEqual(fresh.mightSee.map((r) => r.toHex()));
        expect(inc.pvs.map((r) => r.toHex())).toEqual(fresh.pvs.map((r) => r.toHex()));
      });
    }
  }
});
