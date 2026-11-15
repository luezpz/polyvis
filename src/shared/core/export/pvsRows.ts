/** PVS row decoding shared by both export formats. */

/**
 * Decodes one hex-lsb PVS row into the list of visible leaf indices.
 * Two hex characters per byte; bit `j` lives in byte `j >> 3` at bit `j & 7`.
 * `"-"` is the text format's shorthand for an all-zero row.
 */
export function decodePvsRow(hex: string): number[] {
  const out: number[] = [];
  if (hex === "-") return out;
  for (let b = 0; b * 2 < hex.length; b++) {
    const byte = parseInt(hex.substr(b * 2, 2), 16);
    for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) out.push(b * 8 + bit);
  }
  return out;
}
