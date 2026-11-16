/** Deterministic generators for demo/test levels (dimension-agnostic, no geometry). */

/** Deterministic PRNG (mulberry32) in [0, 1) so generated demos are identical on every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perfect maze on a `w × h` cell grid by randomized DFS. Returns open passages as pairs of
 * cell indices `y * w + x`: a spanning tree, so every cell is reachable and there are no loops.
 */
export function mazeEdges(w: number, h: number, seed: number): [number, number][] {
  const rand = rng(seed);
  const seen = new Uint8Array(w * h);
  const edges: [number, number][] = [];
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1];
    const x = c % w, y = (c / w) | 0;
    const next: number[] = [];
    if (x > 0 && !seen[c - 1]) next.push(c - 1);
    if (x < w - 1 && !seen[c + 1]) next.push(c + 1);
    if (y > 0 && !seen[c - w]) next.push(c - w);
    if (y < h - 1 && !seen[c + w]) next.push(c + w);
    if (!next.length) { stack.pop(); continue; }
    const n = next[Math.floor(rand() * next.length)];
    seen[n] = 1;
    edges.push([c, n]);
    stack.push(n);
  }
  return edges;
}
