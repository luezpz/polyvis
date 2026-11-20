# NOTES

Session memory. Architecture, commands and conventions live in `CLAUDE.md`; this file holds
only decisions, gotchas and open items. The 2D/3D merge (former PLAN.md / PROGRESS.md) is done.

## Key decisions
- **3D is the product; 2D is temporary, a reference / testbed only** (user decision, 2026-11-19). Judge
  every change by its 3D effect: if it helps 3D but worsens 2D, keep it. 2D still has to stay correct
  (tests pass, PVS conservative), just not optimal.
- 2D stays brush-only: no raw-wall/mesh import UI (user decision, 2026-11-15).
  `compileWalls` still accepts raw walls programmatically.
- `makeWall` / CSG `EmptySpaceTest` are not unified across dimensions: 5-line functions over
  different primitives; sharing would need new `Geometry` ops for little gain.
- Intentional parity gaps: probe-from-camera and work plane / brush height are 3D-only;
  vertex drag is 2D-only (3D brushes are planes).
- Corner splits are off by default (2026-11-18). They multiplied leaves and portals, and the flow cost
  grew far faster: with them off, flow is 3–20× faster and 3D Oblique lattice drops from 90 s
  (truncated) to 3 s (docs/OPTIMIZATION-PLAN.md, re-baseline). The option stays for experiments.
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
  walls. BSP is only ~1-2% of a big compile; base vis dominates there.
- Parallel base vis (`shared/core/vis/parallelBaseVis.ts`) is exact: rows are independent
  (`createBaseVisRows`), equal-size portal ranges, 8 chunks per worker, packed graph in, packed
  rows back. Base vis and the passage table share one worker protocol (`RowWorker`, `RowJob`,
  `vis/parallelRows.ts`; app `rowPool.ts`/`rowProtocol.ts`); every app runner uses `poolRunner`
  (size check, fallback, `markBroken`), every chunked stage `parallel/workerQueue`. New parallel
  stages should reuse these rather than add a protocol and pool file each. Threads = n² / `MIN_PAIRS_PER_THREAD` (2 M, see below); under 200 portals,
  one thread. Node threads (`npm run bench -- --threads n --repeat 4`), base vis ms 1 → 4 → 8
  threads: 2D Maze 16x16 983 → 359 → 290, 2D Grid city 238 → 75 → 69, 3D Grid city 636 → 262 →
  164, 3D Pillar forest 175 → 81 → 72; levels under ~550 portals unchanged (stay local).
  Those numbers predate the flat pair test (phase 6a, 5–12× cheaper pairs). Re-measured 2026-11-20
  (`--threads 1/4/8 --repeat 3`): base vis is now <= 26 ms on every bench level and threads never helped
  (sometimes hurt), so `MIN_PAIRS_PER_THREAD` is 2 M (~25 ms per thread); only far bigger levels go parallel.
  Rows are copied out of the packed buffer (`baseVisFromWords`): views would each clone the
  whole buffer when the result is posted to the editor.
- Editors share one nested pool (`shared/app/compile/workerPool.ts`, entry `poolWorker.ts`).
  Only a dead pool worker (`PoolWorkerError`) disables the pool; a stage that throws inside a live
  worker just falls back to one thread for that call (it would throw on any thread).
- `CompileClient` abandons an in-flight compile older than `cancelAfterMs` (1 s) when a newer request
  arrives: it terminates and respawns the worker (and so its nested pool). Fresh compiles are never
  cancelled, so brush drags don't respawn workers on every move.
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

- Optimization work follows `docs/OPTIMIZATION-PLAN.md` (status, before/after tables there).
  Done: phase 0 (bench, flow counters), phase 1 (1a base-vis spheres, 1b separator cache, 1d/1e
  allocation-free flow rows + source early-out), all exact: bench counters identical to the
  baseline. Phase 2a + 2b (`baseVis: "passages"`: canSee table, tighter
  mightSee, per-depth flow pruning) done as an option, default off (table build costs more than it
  saves on shallow levels; fixes the 3D Oblique lattice truncation). Gotcha: with passages the
  flow must order sources by the *base* rows (`orderBy`), else results and step counts drift.
  The table builds on the worker pool (`rowPool.ts`, cost-based thread count) from packed
  inputs (`packPortalGraph`, `BitSet.packRows`): object-graph clones cost ~10 ms per worker. No
  memory cap (dense: slots × portals bits). Any vis change must keep the `--all` non-timing columns identical
  unless it is meant to change results. Bench: `npm run bench [-- --all | --only <s> | --obj <file> | --passages | --cluster | --pvs-cluster [json] | --bsp <json> | --threads <n> | --repeat <k>]`
  (`--threads` = Node worker threads for the passage table; `--repeat` reports the last, warm run);
  it bundles `bench.ts` (`scripts/benchBundle.mjs`, out `node_modules/.bench`) and runs the bundle; `--runner` runs TS through `vite.runnerImport` (no `@types/node`: keep Node APIs in `scripts/bench.mjs`).
- Phase 3e `cluster: "convex"` (option, default off, lossy): vis runs on convex leaf clusters,
  rows mapped back to leaf portals (`expandClusterRows`), so results stay per leaf. Clusters must be
  convex (walls + portals): the flow's `onChain` "no re-entry" rule and precision both need it.
  Phase 3a is a no-op on leaf graphs (one portal per leaf pair). Details in the plan.
- Phase 3c: `PvsTable` also carries column sharing (`leafColumn`, `columnRows`, decode with
  `pvsTableSees`); lossless, always built. Export (v3) still writes wide rows; TODO v4 with `leafColumn`.
- Phase 3b `pvsCluster: "wide"` (option, lossy): leaves grouped *after* the flow
  (`vis/pvsClusters.ts` → `CompileResult.pvsClusters`); `pvs` stays per leaf. Not the same as 3e
  vis clusters (`cluster`), which change the flow. The `maxGrowth` guard must compare with exact leaf
  sums, not previous cluster rows (growth compounds otherwise). Not in the export yet.
- Phase 3f BSP options `facingWeight`, `maxCandidates` (off by default; mixed with corner splits, a clear win without them: default-flip candidate). Any splitter
  change must go through `splitCandidates`/`scoreSplitters` so the parallel BSP stays identical.
- BSP splitter sweep (`bsp/sweep.ts`, always on): `scoreSplitters` scores groups of ≥ 4 parallel candidates
  by sorting fragment extremes along the normal; bit-identical to the per-candidate loop (`useSweep = false`
  is the test reference). Groups need *exactly* equal / negated normals (axis-aligned OBJ data has them).
- `Geometry.facetMeasure` (2D length, 3D area) was added for 3b.
- Phase 3.5: CSG uses a BVH broad phase (`shared/core/spatial/bvh.ts`, both dims; queries return ids ascending
  because 3D fragmentation is order-dependent). `compileSession()` reuses base vis rows (`incrementalBaseVis.ts`)
  and flow rows (`incrementalFlow.ts`) across edits, portals matched by exact geometry (`portalMatch.ts`);
  bit-identical to fresh. Single-threaded, not wired into the editors yet.
- Stable BSP (phase 3.5): splitter candidates in canonical plane order (`planeRanks`; ties → lowest rank),
  so the tree depends on geometry, not wall order; balance |front − back| bucketed at big nodes (`bsp/score.ts`,
  helps 3D, costs 2D: kept); bounds snapped to a coarse grid (`snapBounds`); 3D CSG
  walls keep the brush face's plane (not refitted to the fragment). `compileSession` builds the BSP with
  `buildBspIncremental` (copies unchanged subtrees, equal to `buildBsp`; off with refinement). Session ids
  (`BspCache.ids`) grow over a long session. Splitter hysteresis rejected: session ≠ fresh.

- Phase 4 runtime clipping (`shared/core/runtime`): `visibleLeaves` with `clip: "planes"` (precise: clip the
  winding, next frustum = cone through the clipped winding via `Geometry.portalFrustum`) or `"rect"` (screen
  rects; omnidirectional = cube map of 6 / 4 views). A leaf is re-entered only with a frustum / rect not
  contained in an earlier one (subsumption cut; without it 3D Pillar forest hung). Bench: `--runtime`
  (flow capped for speed; `--exact-pvs` to disable). Export files are v3 (portal `plane` + `closed`).
  Coherence: `createVisCache` (`runtime/cache.ts`) reuses a result only when exact (same inputs + same flags at
  the portals the query read, `readPortals`); cached BitSets / arrays are shared, don't mutate them.
- Phase 4b doors (`shared/core/doors`): a solid brush with `door: "<name>"` is non-structural like detail
  (baked open). The BSP builder is untouched: after it, `splitLeavesByDoors` splits empty leaves along the
  door planes (a tree → tree pass; door volume normals point *into* the door), so each leaf is wholly in or
  out; `findDoors` → `CompileResult.doors` (leaves, boundary portals, `seals` by flood). Runtime:
  `doorPortalOpen` / `closedDoorPortals`. Door faces show up in `detailWalls`. OBJ (3D only): objects /
  groups / materials named `door_<name>` become door brushes (`import/objLevel.ts`); volume = the mesh's
  supporting face planes, so a door mesh must be convex (a slab); one with no bounded volume is skipped and reported.
  OBJ `o` and `g` names are tracked separately (door if group, object or material says so; `o` clears `g`).
- OBJ coplanar merge (`import/obj.ts` `mergeGroup`): half-edges + union-find, O(1) per merge; only the two new
  corners are tested (inputs convex), a 180° reversal counts as non-convex, planarity = signed-distance slab
  ≤ `PLANE_EPSILON` vs the group plane. The old rebuild-per-merge loop was ~O(n⁴) on grids (18 s for 80×80).
- Phase 3d hint faces = per-face splitter bias (`Brush.faceSplitBias` → `Wall.splitBias` → `BuildContext.planeBias`
  → `splitterScore`), not extra hint brushes. A plane takes the lowest nonzero vote of its walls. Builder specs
  give it in face order (3D box −x, +x, −y, +y, −z, +z; 2D box −y, +x, +y, −x); edits carry it by normal. Editor
  UI (both): clicking a face / edge handle in the Select tool selects it (`EditorModel.selectedFace`, reset on brush
  change); the panel's `splitBiasField` sets it via `setFaceSplitBias` (Hint −1000 / Avoid +1000 / Clear presets). OBJ (3D only): material `hint` (bias `OBJ_HINT_BIAS` = −1000) or `hint_<n>` (bias n) →
  `ImportedMesh.faceSplitBias` → mesh walls; hint faces never merge with plain coplanar faces on import.
  Blender's `.001` name suffixes are ignored for both `hint` and `door_`.
- No PAS (decided 2026-11-19): it is a bake-time artifact (can't be rebuilt on map load) and adds little.
  Engines do sound on the portal graph instead (flood from the source leaf), using door portals
  (`DoorInfo.portals`) to attenuate or stop sound.

- Flow hot loops (2026-11-19): 3D `clipWinding` uses a module scratch `Float64Array` (not re-entrant) and
  inlined `signedDistance`; 2D `buildSeparators` inlines the line math.
- No `Math.hypot` anywhere (slow): lengths are `Math.sqrt` of explicit products. Threshold comparisons use
  squared values (`distanceSq` in both vec modules, `MIN_LENGTH_SQ`) and skip the sqrt. Bench results were
  unchanged by the switch.
- BSP tree diagram (2026-11-19): `shared/core/bsp/treeLayout.ts` (layout + balance stats, iterative for deep
  trees) feeds the floating `shared/app/ui/bspTreeView.ts` (layer `bspTree`). Hover/click sets
  `view.bspFocus` (a ChildRef, reset per compile); both renderers highlight front (cyan) / back (orange)
  subtrees + splitter. `bspDepth` layer = leaf depth heatmap.

## Gotchas
- Profiles under `--runner` / vitest show Vite's module runner `get` (import bindings resolved through
  getters) as a large self-time entry; the default bundled bench has none.
- The flow's separator cache (1b) relies on `clipFacet` returning the **same object** when nothing
  is cut (both kernels do); `Geometry.separators` must list planes in `clipToSeparators` order.
- Flow runs on flat arrays (phase 6b, `vis/flatFlow.ts`, `Geometry.flatFlow`); the object walk in
  `portalFlow.ts` is kept as the exact reference (`flat: false`). A change to flow semantics must land in
  both, and in both kernels' `flatKernel.ts` (bit-identical to `clipWinding` / `clipSegmentFront` /
  separators); `tests/shared/flatFlow.test.ts` catches drift.
- `bsp/incremental.ts` keys must keep −0 apart from 0 (`exactKey`): `String(-0)` is "0", but flipped
  planes carry −0 components and the copied tree would differ from `buildBsp`. (`portalKey` conflates them;
  harmless there, matched portals compute identically.)
- Git history of the source repos (`polyvis2d` cdac3e9, `polyvis3d` 2de2526) was not carried over.

## Open TODOs
- Phase 3.5 paused (editor is low priority): wire `compileSession` into the compile worker.
  (`BspCache.ids` is pruned to the last build's keys, so long sessions don't leak; ids come from
  `nextId`, never reused, and a copied subtree re-registers its split ids from `NodeRange.pieceIds`.)
- 3D Oblique lattice truncates at the 20 M `maxSteps` budget (bench, single-threaded; ~92 s
  after phase 1, was ~118 s). Fixed with `baseVis: "passages"` (12.5 M steps, ~70 s), still truncates by default.
- Debug layers portal graph / vis clusters / PVS heatmap read `shared/app/render/debugInfo.ts` (cached per
  result; portal kind = wall split / refinement / cluster-internal via `refinementPortals`). Checked in headless
  Chrome by an agent (2D and 3D render).
- Compile options panel (`shared/app/ui/compileSections.ts`) now exposes every `CompileOptions` field except
  the pipeline-internal `flow.passages` / `flow.orderBy`; never checked in a browser by an agent.
- Browser smoke test never done by an agent: `/2d.html` worker compile, select tool
  (click-to-cycle, edge push/pull), surfaces layer; `/3d.html` panel after the shared-UI refactor.
- Parallel flow and parallel BSP never run in a browser by an agent: confirm nested workers
  start, and measure the speed-up on a big 3D level (console.debug logs ready-source counts);
  tune `MAX_BATCH` / `MIN_PARALLEL_PORTALS` / `MIN_PARALLEL_WALLS` / `MAX_BSP_THREADS`.
- Parallel base vis never run in a browser: confirm the speed-up there (Node numbers in Decisions).
- Doors: door state in the export beyond the `closed` flag (door → portal list; export plan).
- Hint faces: hints in open space
  (non-solid splitter-only walls) if a level needs a cut no face lies on.
- Open decision: merge the two editor shells (panel/app) further, or keep sharing helpers only.
- Convex hulls generation (for physics engines, navmesh, etc.)
- Lightmap baking
