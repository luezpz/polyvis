# PROGRESS

Newest first. One entry per session; say what changed, what was verified, what is next.

## 2026-11-15: Session 4, Phase 4 editor parity

Done
- 2D core: `moveBrushEdge(brush, index, offset)` (half-plane push/pull, analogue of 3D
  `moveBrushFace`; redundant edges vanish, null on collapse).
- 2D select tool: click-to-cycle overlapping brushes (`picking.brushesAt`, same logic as 3D),
  edge push/pull handles (squares at edge midpoints, `edgeHandleAt`, `model.moveEdge`);
  vertex dots still reshape and take precedence. `Painter.square`.
- 2D layers `surfaces` (leaf wall pieces coloured current/visible/culled by the probe's PVS)
  and `hideCulled`, as in 3D.
- `tests/d2/editing.test.ts`: push/pull, collapse, redundant edge removal, `brushesAt` order,
  edge handles. 3D: unchanged (already had all of these).

Verified
- `npm run typecheck` clean; `npm test`: 10 files, 107 tests pass; `npm run build` ok.
- NOT verified in a browser: try `/2d.html` select tool (cycle, edge drag) and surfaces layer.

Next
- Open decision: merge the two editor shells further, or keep sharing helpers only.

## 2026-11-15: Session 3, Phase 3 shared app infrastructure

Done
- New `src/shared/app`: `editor/history.ts` (moved), `editor/viewState.ts` (`BaseViewState`),
  `compile/{compileClient,protocol,serveCompiler}.ts` (generic over `D`, `L`),
  `ui/{dom,widgets,compileSections}.ts`, `ui/styles.css` (base), `render/palette.ts`.
- 2D now compiles in a Web Worker (`d2/app/compile`), shows "Compiling…" like 3D. 3D: unchanged behaviour.
- Both panels build compiler options, export buttons, stats and probe rows from the shared
  helpers. Small visible changes: 2D stats gain "PVS rows" and the leak's reachable count;
  3D timings show 2 decimals; 3D layer labels unchanged.
- `tests/shared/app.test.ts`: history, snapping (2D/3D), `clearProbe`, `hydrateResult`
  after `structuredClone` (2D/3D), `CompileClient` main-thread fallback + request coalescing.

Verified
- `npm run typecheck` clean; `npm test`: 9 files, 102 tests pass; `npm run build` bundles
  both workers.
- NOT verified in a browser (none available to the agent): smoke-test `/2d.html` (worker
  compile, panel) and `/3d.html` with `npm run dev`.

Next
- Phase 4: audit both editors, close 2D gaps.

## 2026-11-15: Session 2, Phase 2 core parity

Done
- 2D export v2 (`polyvis-pvs-2d` 2): shared PVS rows (`leaf.pvs`), top-level `walls`, per-leaf
  wall lists, `decodeLeafPvs`. Text leaf line: `<contents> <pvsRow> <nwalls> <wall>... <nverts> <x y>...`.
  3D: already had it.
- 2D `castRay` / `lineOfSight` in `d2/core/analysis/visibility.ts` (same API as 3D);
  `tests/d2/helpers.ts` no longer defines `lineOfSight`.
- Ported 3D tests to 2D: portal orientation, wall length assigned to leaves, flow strictly
  tighter, truncated flow, shared-rows suite, separators, export v2; plus a 2D `castRay` test.

Verified
- `npm run typecheck` clean; `npm test`: 8 files, 97 tests pass.
- NOT verified in a browser (2D export button only downloads the new document).

Next
- 2D raw-wall import dropped (user decision); Phase 2 otherwise done. Next: Phase 3.
- `makeWall`/`EmptySpaceTest` unification deferred (see PLAN.md).

## 2026-11-15: Session 1, merge + shared core

Done
- Created `polyvis` from `polyvis2d` (commit cdac3e9) and `polyvis3d` (commit 2de2526).
  Source repos untouched; git history not carried over (target is not a git repo yet).
- Extracted the shared compiler core (`src/shared/core`, see PLAN.md Phase 1). Each dimension
  keeps its public API through thin bindings (`d*/core/bsp/bsp.ts`, `vis/vis.ts`,
  `portals/portals.ts`, `pipeline.ts`, `geometry.ts`).
- 2D renames: `Wall.seg/line/brushId` → `winding/plane/sourceId`; `Portal.seg/line/plane` →
  `winding/plane/planeIndex`. Added `sameOrientedLine`, 2D `clipToSeparators`.
- Behaviour notes: 2D inherited the 3D splitter early-out (same result, faster); 2D refine
  now uses the shared candidate search (same choice: bounds filter + thickness + endpoint test);
  2D wall splitting uses `clipSegmentFront` both ways (equivalent to the old `splitSegment`).
  2D compile now also produces `surfaces` and `pvsTable` (unused by 2D UI/export so far).
- Added `tests/shared/geometry.test.ts` (6 tests, both kernels).

Verified
- `npm run typecheck` clean; `npm test`: 8 files, 89 tests pass (2D 32, 3D 51, shared 6).
- `npx vite build` builds all three pages + the 3D worker.
- NOT verified in a browser this session (no browser available to the agent): open
  `/2d.html` and `/3d.html` with `npm run dev` and smoke-test before relying on the editors.

Next
- PLAN.md Phase 2, starting with the 2D export v2 + porting the missing 3D tests to 2D.
