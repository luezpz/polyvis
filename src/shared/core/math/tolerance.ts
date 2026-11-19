/**
 * Numeric tolerances shared by the whole compiler.
 *
 * World units are arbitrary but the editor assumes roughly "1 unit = 1 metre"
 * with levels spanning tens to a few thousand units. All tolerances are
 * absolute and tuned for that range.
 */

/** Distance below which a point is considered to lie *on* a plane (a line in 2D). */
export const PLANE_EPSILON = 1e-5;

/** Edges shorter than this are treated as degenerate (their vertices are merged). */
export const MIN_LENGTH = 1e-4;

/** {@link MIN_LENGTH} squared: compare squared lengths against it and skip the sqrt. */
export const MIN_LENGTH_SQ = MIN_LENGTH * MIN_LENGTH;

/** Polygons (3D windings, 2D cells) with an area below this are treated as degenerate and dropped. */
export const MIN_AREA = 1e-6;

/** 3D only. Polyhedra with a volume below this are treated as degenerate and dropped. */
export const MIN_VOLUME = 1e-7;

/**
 * Offset used when probing "just in front of" / "just behind" a boundary
 * (e.g. to classify which side of a wall is empty space), and the contact
 * tolerance used to decide whether a wall touches a BSP cell. Must be larger
 * than {@link PLANE_EPSILON} and smaller than the smallest feature in a level.
 */
export const PROBE_OFFSET = 1e-3;

/** Grid used to quantize coordinates into hash keys for de-duplication. */
export const KEY_QUANTUM = 1e-4;

/**
 * 3D only. Half-size of the "infinite" windings created for a plane before clipping
 * (Quake's BOGUS_RANGE). Anything this far out is considered unbounded.
 */
export const WORLD_EXTENT = 1e5;
