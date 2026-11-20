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

describe("BitSet.toArray / fromHex", () => {
  it("lists set bits across words, including bit 31 and the last bit", () => {
    const idx = [0, 1, 31, 32, 63, 64, 99];
    expect(BitSet.fromIndices(100, idx).toArray()).toEqual(idx);
    expect(new BitSet(100).toArray()).toEqual([]);
  });

  it("round-trips through hex and rejects malformed input", () => {
    const s = BitSet.fromIndices(37, [0, 9, 36]);
    expect(BitSet.fromHex(37, s.toHex()).equals(s)).toBe(true);
    expect(() => BitSet.fromHex(37, s.toHex() + "00")).toThrow(); // too long
    expect(() => BitSet.fromHex(37, "zz00000000")).toThrow(); // not hex
    expect(() => BitSet.fromHex(37, "00000000e0")).toThrow(); // bits 37..39 beyond size
  });
});
