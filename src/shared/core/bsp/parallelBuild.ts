/**
 * Parallel BSP build with the same tree as the sequential {@link buildBsp}.
 *
 * The two children of a node are independent once its fragments are
 * partitioned, so subtrees can be built anywhere and spliced back in preorder
 * (`assembleTree`). But splitter scoring costs O(candidates × fragments) per
 * node, so the levels near the root dominate (each level costs about half the
 * one above it): farming out subtrees alone caps the speed-up near 2x. So:
 *
 * - The main thread walks the top of the tree. At each big node every worker
 *   scores one chunk of the candidate planes (`scoreSplitters`; the lowest
 *   score, ties to the earliest chunk, is the sequential choice); the main
 *   thread partitions the fragments and descends into both children at once.
 * - Nodes with few fragments, and empty regions (refinement), become whole
 *   subtree tasks. They run after the top walk, largest first, each on the
 *   next idle worker.
 *
 * Messages are kept small and flat (`pack.ts`): walls go out packed once,
 * subtrees come back packed. Fragments are never sent: cloning thousands of
 * windings per node per worker cost more than the build itself. Every worker scores every big node,
 * so it can keep each big node's fragments and derive a child's by repeating
 * the parent's (deterministic) partition; requests name a {@link FragmentSource}.
 *
 * Workers are abstract ({@link BspWorker}) so this stays a pure library: the
 * app backs them with Web Workers, tests with {@link inProcessBspWorker}.
 *
 * Caveat: plane interning is tolerance-based; a refinement plane matching two
 * nearly equal planes from different subtrees could pick the other one than
 * the sequential build. Exact for every sample level and test.
 */

import type { Cell, Dim, Geometry } from "../geometry";
import type { Wall } from "../wall";
import {
  type BspBuildOptions, type BspBuildResult, type Fragment, type Skeleton, type SplitChoice, type Subtree, type SubtreeTask,
  assembleTree, buildSubtree, partition, prepareBuild, rootTask, scoreSplitters, splitCandidates,
} from "./build";
import { type PackedSubtree, packSubtree, packWalls, unpackSubtree, unpackWalls } from "./pack";
import { refinementEnabled } from "./refine";

/**
 * Names the fragments of a node without sending them. Key 0 is the root (all
 * wall fragments); any other node is the `front` or back side of `parent`'s
 * partition by `plane`. The worker must have been asked to `score` `parent`.
 */
export interface FragmentSource {
  readonly key: number;
  readonly parent: number;
  readonly plane: number;
  readonly front: boolean;
}

/** A subtree task as sent to a worker: {@link SubtreeTask} with a {@link FragmentSource} instead of fragments. */
export type RemoteTask<D extends Dim> =
  | { readonly kind: "walls"; readonly source: FragmentSource; readonly region: Cell<D> | null; readonly depth: number }
  | { readonly kind: "empty"; readonly region: Cell<D> | null; readonly depth: number };

/** One BSP thread. Calls are answered in the order they were made. */
export interface BspWorker<D extends Dim> {
  /** Starts a build of `walls` (see `packWalls`) with `opts` (complete). Forgets earlier builds. */
  begin(walls: Float64Array, opts: BspBuildOptions): Promise<void>;
  /** `scoreSplitters` of the source's fragments over `candidates` (may be empty: score `Infinity`). Remembers the fragments. */
  score(source: FragmentSource, candidates: readonly number[]): Promise<SplitChoice>;
  /** `buildSubtree` of `task`, packed. */
  subtree(task: RemoteTask<D>): Promise<PackedSubtree<D>>;
}

/** Nodes with at most this many fragments are never split further on the main thread. */
const MIN_TASK_FRAGMENTS = 64;
/** Aim for this many subtree tasks per worker, so uneven subtrees still balance. */
const TASKS_PER_WORKER = 4;

const ROOT: FragmentSource = { key: 0, parent: -1, plane: -1, front: true };

/**
 * Worker-side state of a build. Repeats `prepareBuild`, so plane numbering
 * matches the main thread's without sending it.
 */
export function createBspSession<D extends Dim>(g: Geometry<D>, walls: Float64Array, opts: BspBuildOptions) {
  const ctx = prepareBuild(g, unpackWalls(g, walls), opts);
  const frags = new Map<number, readonly Fragment<D>[]>([[0, ctx.fragments]]);
  /** Partition of a parent by plane, kept for its second child. Key: `${parent}:${plane}`. */
  const parts = new Map<string, ReturnType<typeof partition<D>>>();

  const resolve = (s: FragmentSource): readonly Fragment<D>[] => {
    const known = frags.get(s.key);
    if (known) return known;
    const parent = frags.get(s.parent);
    if (!parent) throw new Error(`bsp: unknown fragment source ${s.parent}`);
    const id = `${s.parent}:${s.plane}`;
    let part = parts.get(id);
    if (!part) parts.set(id, (part = partition(g, parent, s.plane, ctx.planes)));
    return s.front ? part.front : part.back;
  };

  return {
    score(source: FragmentSource, candidates: readonly number[]): SplitChoice {
      const f = resolve(source);
      frags.set(source.key, f);
      return candidates.length > 0 ? scoreSplitters(g, f, candidates, ctx.planes, opts) : { plane: -1, score: Infinity };
    },
    subtree(task: RemoteTask<D>): PackedSubtree<D> {
      const t: SubtreeTask<D> = task.kind === "walls" ? { kind: "walls", frags: resolve(task.source), region: task.region, depth: task.depth } : task;
      return packSubtree(g, buildSubtree(g, ctx, t));
    },
  };
}

/** A {@link BspWorker} running on the calling thread (tests, and environments without workers). */
export function inProcessBspWorker<D extends Dim>(g: Geometry<D>): BspWorker<D> {
  let session: ReturnType<typeof createBspSession<D>> | null = null;
  const get = () => {
    if (!session) throw new Error("bsp call before begin");
    return session;
  };
  return {
    async begin(walls, opts) { session = createBspSession(g, walls, opts); },
    async score(source, candidates) { return get().score(source, candidates); },
    async subtree(task) { return get().subtree(task); },
  };
}

/**
 * Builds the same tree as `buildBsp(g, walls, opts)` using `workers`
 * (non-empty). Rejects if a worker call fails.
 */
export async function buildBspParallel<D extends Dim>(g: Geometry<D>, walls: readonly Wall<D>[], opts: BspBuildOptions, workers: readonly BspWorker<D>[]): Promise<BspBuildResult<D>> {
  const ctx = prepareBuild(g, walls, opts);
  const root = rootTask(ctx);
  if (root.kind !== "walls") return assembleTree(g, ctx, { kind: "subtree", tree: buildSubtree(g, ctx, root) });

  const packed = packWalls(g, walls);
  await Promise.all(workers.map((w) => w.begin(packed, opts)));
  const run = workerQueue(workers);
  const grain = Math.max(MIN_TASK_FRAGMENTS, Math.ceil(ctx.fragments.length / (workers.length * TASKS_PER_WORKER)));
  let nextKey = 1;

  // Subtree tasks wait until the top is done: queued ahead of a scoring broadcast they would stall the critical path.
  const pending: { task: RemoteTask<D>; size: number; slot: { kind: "subtree"; tree: Subtree<D> } }[] = [];
  const remote = (task: RemoteTask<D>, size: number): Skeleton<D> => {
    const slot = { kind: "subtree" as const, tree: null as unknown as Subtree<D> };
    pending.push({ task, size, slot });
    return slot;
  };
  const local = (task: SubtreeTask<D>): Skeleton<D> => ({ kind: "subtree", tree: buildSubtree(g, ctx, task) });

  /** Splitter for a big node: every worker scores one chunk (and so learns the node's fragments). */
  const choose = async (source: FragmentSource, frags: readonly Fragment<D>[]): Promise<number> => {
    const candidates = splitCandidates(frags);
    const size = Math.ceil(candidates.length / workers.length);
    // Sent past the queue: all workers must see this node before any of its children.
    const choices = await Promise.all(workers.map((w, i) => w.score(source, candidates.slice(i * size, (i + 1) * size))));
    // Strictly lower only: ties go to the earliest chunk, like the sequential scan.
    return choices.reduce((best, c) => (c.score < best.score ? c : best)).plane;
  };

  const top = async (source: FragmentSource, frags: readonly Fragment<D>[], region: Cell<D> | null, depth: number): Promise<Skeleton<D>> => {
    if (frags.length <= grain) return remote({ kind: "walls", source, region, depth }, frags.length);
    const planeIndex = await choose(source, frags);
    const plane = ctx.planes[planeIndex];
    const part = partition(g, frags, planeIndex, ctx.planes);
    const frontRegion = region && g.clipCell(region, plane, planeIndex);
    const backRegion = region && g.clipCell(region, g.flipPlane(plane), planeIndex);
    const child = (front: boolean): FragmentSource => ({ key: nextKey++, parent: source.key, plane: planeIndex, front });
    const empty = { kind: "empty", region: frontRegion, depth: depth + 1 } as const;
    const [front, back] = await Promise.all([
      part.front.length > 0 ? top(child(true), part.front, frontRegion, depth + 1) : refinementEnabled(opts) ? remote(empty, 0) : local(empty),
      part.back.length > 0 ? top(child(false), part.back, backRegion, depth + 1) : local({ kind: "solid", region: backRegion, depth: depth + 1 }),
    ]);
    return { kind: "node", plane: planeIndex, region, splits: part.splits, front, back };
  };

  const skeleton = await top(ROOT, root.frags, root.region, 0);
  // Largest first, so the long tasks do not end up last on one worker (empty regions count as small).
  pending.sort((a, b) => b.size - a.size);
  await Promise.all(pending.map((p) => run((w) => w.subtree(p.task)).then((packedTree) => { p.slot.tree = unpackSubtree(g, packedTree); })));
  return assembleTree(g, ctx, skeleton);
}

/** Runs each job on the next idle worker, queueing jobs while all are busy. */
function workerQueue<W>(workers: readonly W[]): <T>(job: (w: W) => Promise<T>) => Promise<T> {
  const idle = [...workers];
  const waiting: ((w: W) => void)[] = [];
  return async (job) => {
    const w = idle.pop() ?? (await new Promise<W>((resolve) => waiting.push(resolve)));
    try {
      return await job(w);
    } finally {
      const next = waiting.shift();
      if (next) next(w);
      else idle.push(w);
    }
  };
}
