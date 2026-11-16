/** Built-in sample levels used by the editor and the test-suite. Z is up; 1 unit ≈ 1 m. */

import type { Level } from "./level";
import { build, ngon, ramp, room, solid } from "./builder";

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
    description: "Rooms, corridors, a hexagonal chamber, pillars, an upper floor reached by a ramp.",
    create: () =>
      build([
        room(0, 0, 0, 10, 8, 4), // A
        solid(4, 3, 0, 6, 5, 4), // pillar in A
        room(10, 3, 0, 20, 5, 3), // corridor A-B
        room(20, 0, 0, 28, 12, 8), // B: tall hall
        ramp(20, 22, 2, 10, 0, 4), // ramp in B up to the balcony
        solid(20, 10, 0, 28, 12, 4), // block under the balcony
        room(23, 12, 4, 25, 22, 7), // upper corridor B-C
        room(14, 22, 0, 30, 30, 7), // C
        solid(18, 25, 0, 19, 27, 7), // pillars in C
        solid(24, 25, 0, 25, 27, 7),
        room(4, 25, 0, 14, 27, 3), // corridor C-D
        room(0, 20, 0, 4, 32, 4), // D
        room(4, -4, 0, 6, 0, 3), // corridor A-E
        { kind: "room", prism: ngon(5, -7, 4.5, 6, Math.PI / 6), z0: 0, z1: 5 }, // E (hexagon)
      ]),
  },
  {
    name: "Zigzag",
    description: "A zigzag corridor: rooms at either end must not see each other.",
    create: () =>
      build([
        room(0, 0, 0, 6, 6, 4),
        room(6, 2, 0, 12, 4, 3),
        room(10, 4, 0, 12, 12, 3),
        room(12, 10, 0, 18, 12, 3),
        room(16, 12, 0, 18, 18, 3),
        room(18, 16, 0, 24, 18, 3),
        room(24, 14, 0, 30, 20, 4),
      ]),
  },
  {
    name: "Two storeys",
    description: "Two rooms stacked on top of each other, joined by a stair shaft with a ramp.",
    create: () =>
      build([
        room(0, 0, 0, 12, 10, 3), // ground floor
        room(0, 0, 4, 12, 10, 7), // upper floor (1 m slab in between)
        room(8, 2, 0, 12, 8, 7), // stair shaft cuts the slab
        ramp(8, 10, 2, 8, 0, 4), // ramp inside the shaft
        room(12, 4, 4, 20, 6, 6.5), // upper corridor
        room(20, 0, 4, 28, 10, 7), // upper side room
        room(-8, 4, 0, 0, 6, 2.5), // ground corridor
        room(-16, 0, 0, -8, 10, 3), // ground side room
      ]),
  },
  {
    name: "Pillared hall",
    description: "A big hall full of occluding pillars plus side rooms.",
    create: () =>
      build([
        room(0, 0, 0, 30, 20, 5),
        solid(4, 4, 0, 6, 6, 5), solid(12, 4, 0, 14, 6, 5), solid(20, 4, 0, 22, 6, 5),
        solid(8, 9, 0, 10, 11, 5), solid(16, 9, 0, 18, 11, 5), solid(24, 9, 0, 26, 11, 5),
        solid(4, 14, 0, 6, 16, 5), solid(12, 14, 0, 14, 16, 5), solid(20, 14, 0, 22, 16, 5),
        room(30, 8, 0, 34, 12, 3), room(34, 2, 0, 42, 18, 4),
        room(-4, 15, 0, 0, 17, 3), room(-12, 12, 0, -4, 20, 4),
      ]),
  },
  {
    name: "Two rooms",
    description: "The smallest interesting case: two rooms and a doorway.",
    create: () => build([room(0, 0, 0, 8, 8, 4), room(8, 3, 0, 10, 5, 2.5), room(10, 0, 0, 18, 8, 4)]),
  },
];
