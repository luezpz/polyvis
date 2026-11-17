# NOTES

Session memory. Architecture, commands and conventions live in `CLAUDE.md`; this file holds
only decisions, gotchas and open items. The 2D/3D merge (former PLAN.md / PROGRESS.md) is done.

## Key decisions
- 2D stays brush-only: no raw-wall/mesh import UI (user decision, 2026-11-15).
  `compileWalls` still accepts raw walls programmatically.
- `makeWall` / CSG `EmptySpaceTest` are not unified across dimensions: 5-line functions over
  different primitives; sharing would need new `Geometry` ops for little gain.
- Intentional parity gaps: probe-from-camera and work plane / brush height are 3D-only;
  vertex drag is 2D-only (3D brushes are planes).
- Corner splits stay local: a wall is a candidate only for cells it touches itself. 3D touch
  must count point/edge contacts (`d3/core/bsp/refine.ts` clips raw vertices, not
  `clipWinding`, which drops zero-area remnants); cells beside a doorway often meet the lintel or
  jamb only that way. Rejected: inheriting candidates down the refinement recursion (planes
  from far walls cut whole rooms: "Two storeys" upper room); accepting walls whose extension
  reaches the cell (branch `proto/corner-split-extension`, about 2x the cells).
- Parallel portal flow (`shared/core/vis/parallelFlow.ts`) is exact: source i depends only on
  deps(i) = { j in mightSee[i] : rank(j) < rank(i) } (it reads finished rows only for portals in
  its `might` set), so it starts when those finish; `flowFromSource`'s `rank` arg makes workers
  ignore rows of later sources. Same `portalVis` as single-threaded unless `maxSteps` truncates
  (budget checked at dispatch). Rejected: fixed waves (branch `parallel-portal-flow`, slightly
  looser results); splitting one source's DFS (few uneven branches, a round trip per source).
  The editors' compile worker spawns nested flow workers (`shared/app/compile/flowPool.ts`,
  cores - 1, max 16); graphs under 200 portals, or no nested-worker support, use one thread.
  Sample levels allow little concurrency (mean ~2-3 ready sources, in-process measurement).
- Parallel BSP build (`shared/core/bsp/parallelBuild.ts`) gives the same tree as `buildBsp`
  (tested with `toEqual`); `buildBsp` itself is now one subtree task + `assembleTree`, which
  splices subtrees in preorder and renumbers their refinement planes (`Geometry.retagCell`).
  Root splitter scoring is ~40% of the build, so the main thread walks the top and every worker
  scores a candidate chunk per big node; small nodes / empty regions become subtree tasks, run
  only after the top walk (queued ahead of scoring they stalled it). Messages are flat
  (`bsp/pack.ts`, `Geometry.pack*`): cloning regions as objects cost ~200 ms on 4k walls, more
  than the build; workers keep big nodes' fragments and re-derive children by partition.
  Measured with Node threads, 4271 walls (300-room `randomLevel`): 514 -> 335 ms with 4 threads,
  worse with 8+ (serial setup ~75 ms, top walk); so capped at 4 (`bspPool.ts`), used from 300
  walls. BSP is only ~1-2% of a big compile; base vis (single-threaded) dominates there.
  Editors share one nested pool (`shared/app/compile/workerPool.ts`, entry `poolWorker.ts`).
- Levels: `SAMPLE_LEVELS` (basic, used by every test suite) vs `DEMO_LEVELS` (`level/demos.ts`,
  grouped Heavy / Worst case / Edge case; only the cheap ones are tested, in `tests/d*/demos.test.ts`).
  Editors list `ALL_LEVELS` via `levelSelect` (optgroups). Writing helpers live in `level/builder.ts`;
  seeded maze/RNG in `shared/core/gen`. Single-threaded Node times: 2D Pillar forest ~11 s; 3D
  Oblique lattice ~110 s, almost all portal flow (near-total visibility over short pillars).

- Detail brushes (`Brush.detail`, solid only) go through CSG twice: the BSP gets the CSG of
  structural brushes only (`isStructural`), and `buildDetailWalls` takes the CSG of **all**
  brushes and keeps the detail brushes' faces (`CompileResult.detailWalls`: trimmed, drawn,
  never in the BSP). Rejected: one full CSG with detail faces dropped. That leaves holes in
  structural faces (the floor under a pillar) and the BSP leaks. Detail brushes never occlude
  (the PVS only grows, so it stays conservative). Non-cutting yet occluding is impossible: a
  solid-leaf BSP has only solid/empty leaves, and portal flow sees only BSP walls. The flag is
  ignored on rooms: a detail room would remove empty space. TODO: export `detailWalls` with
  the leaves each face touches, so a game can PVS-cull them.

## Gotchas
- Git history of the source repos (`polyvis2d` cdac3e9, `polyvis3d` 2de2526) was not carried over.

## Open TODOs
- Browser smoke test never done by an agent: `/2d.html` worker compile, select tool
  (click-to-cycle, edge push/pull), surfaces layer; `/3d.html` panel after the shared-UI refactor.
- Parallel flow and parallel BSP never run in a browser by an agent: confirm nested workers
  start, and measure the speed-up on a big 3D level (console.debug logs ready-source counts);
  tune `MAX_BATCH` / `MIN_PARALLEL_PORTALS` / `MIN_PARALLEL_WALLS` / `MAX_BSP_THREADS`.
- Base vis (`computeBaseVis`) is the biggest stage on large levels (118 s vs 2.7 s BSP at 300
  rooms) and is still single-threaded: the next parallelization target.
- Open decision: merge the two editor shells (panel/app) further, or keep sharing helpers only.
