/**
 * Minimal immutable 3D vector toolkit.
 *
 * Vectors are plain `{ x, y, z }` objects so they serialize trivially and can
 * be created with literals. All functions are pure. The world is **Z-up**
 * (like Quake and Blender).
 */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

/** a + b * s */
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Right-handed cross product. */
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const distance = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSq(a, b));
/** Squared distance: use it for threshold comparisons (no sqrt). */
export const distanceSq = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

/** Returns the unit vector in the direction of `a`, or ZERO for a zero-length input. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? { x: a.x / len, y: a.y / len, z: a.z / len } : ZERO;
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export const midpoint = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 });

export const nearlyEqual = (a: Vec3, b: Vec3, eps: number): boolean =>
  Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.z - b.z) <= eps;

/** Average of a point list (ZERO for an empty one). */
export function average(points: readonly Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const p of points) { x += p.x; y += p.y; z += p.z; }
  const n = Math.max(1, points.length);
  return { x: x / n, y: y / n, z: z / n };
}

/** Formats a vector for debugging. */
export const formatVec = (a: Vec3, digits = 3): string => `(${a.x.toFixed(digits)}, ${a.y.toFixed(digits)}, ${a.z.toFixed(digits)})`;
