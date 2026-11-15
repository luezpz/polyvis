# PLAN

Goal: one repo, two dimensions, maximum shared code, **feature parity** between 2D and 3D.
2D is the testbed for ideas; working ideas get ported to (or written once for) 3D.

Status legend: [x] done · [ ] todo · (n/a) not meaningful in that dimension.

## Phase 1: Merge + shared compiler core  ✅
- [x] Copy both repos side by side (`src/d2`, `src/d3`, `tests/d2`, `tests/d3`); green baseline.
- [x] `Geometry<D>` seam (`src/shared/core/geometry.ts`) + `geometry2` / `geometry3`.
- [x] Shared: tolerances, Side, Wall, BSP build/refine/query/surfaces/types, portal graph types,
      components, leaks, BitSet, base vis, portal flow, leaf PVS, PVS row table, pipeline, decodePvsRow.
- [x] 2D field names aligned with 3D (`winding`/`plane`/`sourceId`/`planeIndex`).
- [x] Contract tests for both kernels (`tests/shared`).
- [x] Multi-page Vite build (`index.html`, `2d.html`, `3d.html`).
- [x] Docs: AGENTS.md, PLAN.md, PROGRESS.md, README, ALGORITHMS index.

## Phase 2: Core parity (2D catches up with 3D)
2D now computes leaf surfaces and the shared PVS row table (shared pipeline) but does not use them yet.
- [ ] 2D export v2: shared PVS rows (`leaf.pvs` row index), per-leaf wall lists, `walls` array,
      `decodeLeafPvs`; bump `polyvis-pvs-2d` to version 2; port the 3D export tests.
- [ ] 2D `analysis`: `castRay` / `lineOfSight` in core (now only in `tests/d2/helpers.ts`),
      same API as 3D; 3D could gain a visibility "polygon" analogue only if useful (n/a likely).
- [ ] Port 3D tests missing from 2D: "assigns every bit of wall area to exactly one empty leaf",
      "orients portals into their destination leaf", "truncated flow falls back to base vis",
      "flow strictly tighter somewhere", the shared-rows suite, the separators test.
- [ ] 2D raw-wall import (3D has OBJ): e.g. polyline/SVG-path import → walls, leaks reported.
      Decide format with the user before building.
- [ ] Unify `makeWall` and the CSG `EmptySpaceTest`/classification helpers where shapes match.

## Phase 3: Shared app infrastructure
Pure, dimension-agnostic app code that is currently duplicated or 3D-only:
- [ ] Move `history.ts` (byte-identical) to `src/shared/app/editor`.
- [ ] Generic compile worker: `CompileClient`/protocol/worker parameterized by the compiler;
      2D compiles off the main thread too.
- [ ] `ui/dom.ts` (2D lacks `pickFile`), `styles.css` common base, colour palette shared parts.
- [ ] Panel sections built from shared helpers (BSP/flow option fields, stats, timings, export buttons).
- [ ] Shared `ViewState` core (layers, inspect state, snapping), dimension extras on top.

## Phase 4: Editor feature parity
| feature                                   | 2D | 3D |
|-------------------------------------------|----|----|
| select / box / polygon / inspect tools    | x  | x  |
| undo/redo, autosave, save/open JSON       | x  | x  |
| click-to-cycle overlapping brushes        |    | x  |
| face/edge handles (push/pull)             | ?  | x  |
| surfaces coloured by PVS, hide culled     |    | x  |
| probe from camera position                | (n/a: 2D probe follows the mouse) | x |
| compile in a worker                       |    | x  |
| raw geometry import                       |    | x (OBJ) |
| work plane / brush height                 | n/a | x |
- [ ] Fill the table precisely (audit both editors) and close each 2D gap.

## Open decisions (ask the user)
- 2D raw-geometry import format.
- Whether to merge the two editors' shells (panel/app) further, or keep them separate and only share helpers.
