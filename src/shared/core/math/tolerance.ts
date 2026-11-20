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

/**
 * Ray casts (picking, line-of-sight checks): a ray is parallel to a plane when the sine of its angle to
 * it is below this, and it misses a winding when the hit lies further than this outside an edge
 * (world units). Much tighter than {@link PLANE_EPSILON} so the line-of-sight tests stay strict.
 */
export const RAY_EPSILON = 1e-9;

/** Grid used to quantize coordinates into hash keys for de-duplication. */
export const KEY_QUANTUM = 1e-4;

/**
 * 3D only. Half-size of the "infinite" windings created for a plane before clipping
 * (Quake's BOGUS_RANGE). Anything this far out is considered unbounded.
 */
export const WORLD_EXTENT = 1e5;

/**
 * Scale-free degeneracy test for a plane through edge `e` and point `v` (separators): the plane is
 * skipped when `|e × v| < SEPARATOR_SIN_EPSILON · |e| · |v|`, i.e. the sine of the angle between `e`
 * and `v` is below this (v lies on the edge's line). Relative, so it behaves the same at any level scale.
 */
export const SEPARATOR_SIN_EPSILON = 1e-10;

/** Near-zero determinant / cross product: two directions are parallel (2D intersection, area tests). */
export const PARALLEL_EPSILON = 1e-12;

/** Two unit normals with `dot > 1 - NORMAL_EPSILON` are the same direction (collinear / coplanar merges). */
export const NORMAL_EPSILON = 1e-9;
