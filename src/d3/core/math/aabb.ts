/** Axis-aligned bounding boxes. */

import type { Vec3 } from "./vec3";

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export function aabbFromPoints(points: Iterable<Vec3>): Aabb | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }
  return minX <= maxX ? { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } } : null;
}

export const expandAabb = (b: Aabb, margin: number): Aabb => ({
  min: { x: b.min.x - margin, y: b.min.y - margin, z: b.min.z - margin },
  max: { x: b.max.x + margin, y: b.max.y + margin, z: b.max.z + margin },
});

export const unionAabb = (a: Aabb, b: Aabb): Aabb => ({
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
});

export const aabbOverlaps = (a: Aabb, b: Aabb, eps = 0): boolean =>
  a.min.x <= b.max.x + eps && b.min.x <= a.max.x + eps &&
  a.min.y <= b.max.y + eps && b.min.y <= a.max.y + eps &&
  a.min.z <= b.max.z + eps && b.min.z <= a.max.z + eps;

export const aabbContains = (b: Aabb, p: Vec3, eps = 0): boolean =>
  p.x >= b.min.x - eps && p.x <= b.max.x + eps &&
  p.y >= b.min.y - eps && p.y <= b.max.y + eps &&
  p.z >= b.min.z - eps && p.z <= b.max.z + eps;

export const aabbCenter = (b: Aabb): Vec3 => ({ x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 });

export const aabbSize = (b: Aabb): Vec3 => ({ x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z });

export const aabbVolume = (b: Aabb): number => (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z);

/** Length of the box diagonal. */
export const aabbDiagonal = (b: Aabb): number => Math.sqrt((b.max.x - b.min.x) ** 2 + (b.max.y - b.min.y) ** 2 + (b.max.z - b.min.z) ** 2);
