/** Palette parts shared by both editors (dark theme), so brushes and leaves look the same in 2D and 3D. */

/** Brush kinds as plain strings: shared code never imports a dimension's `BrushKind`. */
export type KindName = "room" | "solid";

/** Base colour of each brush kind as a CSS hex string, and as RGB 0..1 for WebGL. */
export const KIND_HEX: Readonly<Record<KindName, string>> = { room: "#4da3ff", solid: "#ff5d73" };
export const KIND_RGB: Readonly<Record<KindName, readonly [number, number, number]>> = { room: [0.3, 0.64, 1], solid: [1, 0.36, 0.45] };

/** Distinct, stable hue (degrees 0..360) per leaf index: golden-angle walk so neighbours differ. */
export function leafHue(index: number): number {
  return (index * 137.508) % 360;
}

/**
 * BSP tree focus colours (RGB 0..1), the same in the tree diagram and both scene views:
 * the focused node's front subtree, its back subtree, and the node itself / its splitter.
 */
export const BSP_FRONT_RGB: readonly [number, number, number] = [0.3, 0.85, 1];
export const BSP_BACK_RGB: readonly [number, number, number] = [1, 0.62, 0.2];
export const BSP_FOCUS_RGB: readonly [number, number, number] = [1, 1, 1];
