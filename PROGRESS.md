# PROGRESS

Newest first. One entry per session; say what changed, what was verified, what is next.

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
