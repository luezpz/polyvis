/** Classification of a point or primitive against an oriented plane (a line in 2D). */
export const Side = {
  Front: 1,
  Back: -1,
  On: 0,
  /** Primitive has parts strictly on both sides. */
  Spanning: 2,
} as const;
export type Side = (typeof Side)[keyof typeof Side];
