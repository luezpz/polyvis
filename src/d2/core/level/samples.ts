/** Built-in sample levels used by the editor and the test-suite. */

import type { Level } from "./level";
import { build, ngon, room, solid } from "./builder";

/** A named level factory; `group` sorts demos in the editor's picker. */
export interface SampleLevel {
  readonly name: string;
  readonly group?: string;
  readonly description: string;
  readonly create: () => Level;
}

export const SAMPLE_LEVELS: readonly SampleLevel[] = [
  {
    name: "Complex",
    description: "Several rooms, corridors, a hexagonal chamber and pillars.",
    create: () =>
      build([
        room(0, 0, 10, 8), // A
        room(10, 3, 20, 5), // corridor A-B
        room(20, 0, 28, 12), // B
        solid(23, 4, 25, 8), // block inside B
        room(23, 12, 25, 22), // corridor B-C
        room(14, 22, 30, 30), // C
        solid(18, 25, 19, 27), // pillars in C
        solid(24, 25, 25, 27),
        room(4, 25, 14, 27), // corridor C-D
        room(0, 20, 4, 32), // D
        room(4, -4, 6, 0), // corridor A-E (overlaps the hexagon)
        { kind: "room", points: ngon(5, -7, 4.5, 6, Math.PI / 6) }, // E (hexagon)
      ]),
  },
  {
    name: "Zigzag",
    description: "A zigzag corridor: rooms at either end must not see each other.",
    create: () =>
      build([
        room(0, 0, 6, 6),
        room(6, 2, 12, 4),
        room(10, 4, 12, 12),
        room(12, 10, 18, 12),
        room(16, 12, 18, 18),
        room(18, 16, 24, 18),
        room(24, 14, 30, 20),
      ]),
  },
  {
    name: "Pillared hall",
    description: "A big hall full of occluding pillars plus side rooms.",
    create: () =>
      build([
        room(0, 0, 30, 20),
        solid(4, 4, 6, 6), solid(12, 4, 14, 6), solid(20, 4, 22, 6),
        solid(8, 9, 10, 11), solid(16, 9, 18, 11), solid(24, 9, 26, 11),
        solid(4, 14, 6, 16), solid(12, 14, 14, 16), solid(20, 14, 22, 16),
        room(30, 8, 34, 12), room(34, 2, 42, 18),
        room(-4, 15, 0, 17), room(-12, 12, -4, 20),
      ]),
  },
  {
    name: "Two rooms",
    description: "The smallest interesting case: two rooms and a doorway.",
    create: () => build([room(0, 0, 8, 8), room(8, 3, 10, 5), room(10, 0, 18, 8)]),
  },
];
