import { describe, expect, it } from "vitest";
import { BitSet } from "../../src/shared/core/vis/bitset";

describe("BitSet.andInto", () => {
  it("writes a ∩ b in place and reports bits not in seen", () => {
    const a = BitSet.fromIndices(70, [1, 5, 40, 69]);
    const b = BitSet.fromIndices(70, [5, 40, 41, 69]);
    const out = new BitSet(70);
    expect(BitSet.andInto(out, a, b, BitSet.fromIndices(70, [5]))).toBe(true);
    expect(out.toArray()).toEqual([5, 40, 69]);
    expect(BitSet.andInto(out, a, b, BitSet.fromIndices(70, [5, 40, 69]))).toBe(false);
  });

  it("allows out to alias an input", () => {
    const a = BitSet.fromIndices(40, [2, 3, 33]);
    expect(BitSet.andInto(a, a, BitSet.fromIndices(40, [3, 33]), new BitSet(40))).toBe(true);
    expect(a.toArray()).toEqual([3, 33]);
  });
});
