/**
 * BSP splitter score, shared by the per-candidate scan (`build.ts`) and the sweep (`sweep.ts`),
 * which must agree bit for bit.
 */

import type { BspBuildOptions, BuildContext } from "./build";

/** Nodes with fewer than 2× this many fragments score |front − back| exactly; see {@link balanceQuantum}. */
const BALANCE_BUCKETS = 32;

/**
 * Step the imbalance |front − back| is rounded down to when `n` fragments are scored:
 * 2^⌊log2(n / 32)⌋ (≥ 1). A local edit changes front / back counts by a few, which near the root
 * would flip between near-equal candidates and reshuffle the whole tree; in buckets they tie and
 * the canonical plane order decides (phase 3.5, stable BSP). Small nodes (n < 64) stay exact.
 * Kept for 3D (edit matching 90.2 → 91.6%) although it costs 2D (95.4 → 93.9%): 3D is the product.
 */
export function balanceQuantum(n: number): number {
  return n < 2 * BALANCE_BUCKETS ? 1 : 2 ** Math.floor(Math.log2(n / BALANCE_BUCKETS));
}

/**
 * Splitter score (lower is better):
 *   splitWeight·splits + balanceWeight·q·⌊|front − back| / q⌋ − facingWeight·onPlane + bias,
 * q = {@link balanceQuantum}(fragment count); `onPlane` = fragments consumed by the node;
 * `bias` = the candidate plane's {@link BuildContext.planeBias} (phase 3d hint faces).
 */
export function splitterScore(splits: number, front: number, back: number, onPlane: number, q: number, opts: BspBuildOptions, bias = 0): number {
  const imbalance = Math.abs(front - back);
  return splits * opts.splitWeight + (q === 1 ? imbalance : Math.floor(imbalance / q) * q) * opts.balanceWeight - (opts.facingWeight ?? 0) * onPlane + bias;
}
