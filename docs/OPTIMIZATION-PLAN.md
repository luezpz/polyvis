# Vis optimization plan

Goal: faster compile (tighter base vis, cheaper flow) and a runtime visibility layer
(Doom 3-style portal clipping, pre-baked PVS as prefilter). Background:
`docs/visibility-design-notes.md`.

Rules for every phase: shared code in `src/shared/core/vis` (generic over `Geometry<D>`),
both dimensions, LOS conservativeness tests must pass unchanged, one test per new option,
measure before/after with the phase 0 bench. Each phase is an option (default off) until the
bench shows a win, then flip the default.

## Phase 0: measure (prerequisite)

- `scripts/bench.ts` (run with `npx vite-node` or vitest bench): compile demo mazes + one large
  OBJ, report per stage: base vis ms, Σ|mightSee|, flow ms, steps, separator clips, final Σ|vis|.
- Add counters to `PortalFlowStats`: `separatorClips`, `classifyCalls` (cheap increments).
- Output: baseline table committed to this file.

## Phase 1: cheap hot-loop wins (Q2 / q3map2)

1a. **Bounding-sphere reject** (Q2 `portal->origin/radius`).
  - Precompute per portal `center: Vec<D>`, `radius`. In `portalMightSeePortal`:
    `signedDistance(pi.plane, cj) < -rj` → reject; `> rj` → Front without classifying.
  - Same quick test before each `clipFacet` in the flow (whole winding on one side).
  - Needs: `Geometry.facetCenterRadius` (or compute from `facetPoints`), contract test.
1b. **Separator caching** (q3map2 `stack->seperators`).
  - Separators of (source, pass) depend only on the frame, not the generator. Build once per
    recursion frame, then clip each generator against the list.
  - Split `clipToSeparators` into `separators(from, to): Plane[]` + `clipFacet` loop; both
    kernels; contract test that cached == uncached.
  - Caveat: with `clipSource`, the source is re-clipped per generator; cache only for the
    unclipped-source case or key the cache on the source winding identity.
1c. **Winding pooling** (Q1 stack windings): only if the bench shows GC time. Deferred.
1d. **Allocation-free bitsets in the flow.** `might.and(...)` allocates a BitSet per step:
  use one preallocated row per recursion depth, and fuse `and` + `hasAnyNotIn(vis)` into one
  word loop that returns "anything new".
1e. **Source early-out**: stop a source as soon as `vis == mightSee[source]` (nothing left to
  find). Cheap word compare at each set.
1f. **Flat portal storage in workers** (SoA typed arrays for windings/planes, like
  `bsp/pack.ts`), so the hot loop reads numbers instead of objects. Only if the bench shows
  object access dominating.
1g. **Separator order / early reject**: test the generator against the source and pass
  planes before building separators; test the separators most likely to clip first (last
  one that clipped, Quake-style heuristics).

## Phase 2: tighter base vis (q3map2 passage vis)

2a. **Tightened mightSee** (default candidate).
  - For each portal p and each t ∈ portalsFrom[p.to] ∩ mightSee[p]:
    `canSee(p,t) = { k ∈ mightSee[p] ∩ mightSee[t] : clipToSeparators(p.w, t.w, k.w) ≠ null }`.
  - `mightSee'[p] = ∪_t ({t} ∪ canSee(p,t))`, then re-run the flood. Uses 1b's cached
    separators (one set per (p,t)).
  - New module `vis/passages.ts`; pipeline option `basevis: "planes" | "passages"`.
  - Parallel: one task per p on the existing worker pool (rows are independent).
  - Tests: mightSee' ⊆ mightSee; final PVS identical (flow is exact either way).
2b. **Full passage rows in flow** (only if 2a leaves deep chains dominant).
  - Keep `canSee(p,t)` rows; flow at depth ≥ 2: `newMight &= canSee(pass, gen)`.
  - Memory: sparse / store only rows strictly tighter than mightSee[t]; pack in flowProtocol.

## Phase 3: smaller graph

3a. **Portal merging**: coplanar portals between the same leaf pair whose union is convex.
3b. **Clusters** (lossy, fewer units).
  - Merge leaves joined by wide portals (area ≥ ~0.5 × leaf cross-section, tune) plus leaves
    split only by refinement. `leafCluster[leaf]` → cluster id.
  - Export PVS per cluster: source row = OR of its leaves' rows, bits = clusters.
  - Flow on leaves (exact, then cluster at export) or on clusters (faster, looser): option.
  - Tests: cluster PVS ⊇ leaf PVS mapped to clusters; LOS tests via leaf → cluster lookup.
3c. **Keep PVS indirection, extend it** (lossless, same units; stacks on clusters).
  - `PvsTable` stays: dedup rows of whatever the unit is (leaves or clusters); clustering
    saturates rows, so duplicates get more common, not less.
  - Add column sharing: group units with identical columns, store one bit per group,
    `unitColumn[unit]` → group. Decoding stays bit-exact.
  - Order: cluster (optional) → dedup rows → share columns.
3d. **Hint walls** (`hint_` material/brush): split planes that are never solid.
3e. **Lossless leaf merging**: after the BSP, merge two empty leaves sharing a portal when
  their union is convex (exact: no vis is lost). Fewer leaves and portals for the flow.
3f. **Splitter heuristic**: score BSP candidate planes by portals/leaves created (not only
  walls split); sample candidates on big levels to keep the build fast.

## Phase 3.5: editor turnaround

- **Incremental recompile**: after an edit, rebuild only the BSP subtrees and portals whose
  bounds touch the change; rerun flow only for sources whose mightSee reaches changed
  portals; reuse cached rows for the rest. Biggest win for editing, not for final bakes.

## Phase 4: runtime portal clipping (Doom 3, PVS as prefilter)

Pure TS module `src/shared/core/runtime/` (no DOM; usable in editor preview and engines).

- Export: per-leaf (or cluster) portal list with windings + planes, `closed` flag for latent
  portals (doors), PVS rows. Layout: flat typed arrays (like `bsp/pack.ts`).
- Query: `visibleLeaves(graph, pvs, cameraLeaf, eye, frustumPlanes, portalOpen) → BitSet`.
  ```
  visit(leaf, frustum):
    for p in portalsFrom[leaf]:
      if !open[p] or !pvs[cameraLeaf].has(p.to): continue
      if eye is behind p.plane: continue
      f = frustum ∩ planes(eye, p.winding)   // narrowed frustum through the portal
      if f empty: continue
      mark p.to; visit(p.to, f)
  ```
  Frustum through a portal = planes from the eye through each portal edge (3D) / two rays (2D);
  new `Geometry` op `portalFrustum(eye, facet)`, contract-tested.
- Tests: traversal ⊆ PVS row; never misses a ray-tested visible leaf (random eyes, both dims).
- Editor: probe mode shows runtime-visible leaves vs PVS leaves for the camera.
- **Screen-rect mode** (Doom 3): narrow a 2D screen rectangle per portal (project winding,
  intersect rects) instead of plane frusta. Cheaper, looser; option `clip: "planes" | "rect"`.
- **Object and light culling**: entities/lights are registered in the leaves their bounds
  touch (BSP query); drawn/lit only if a touched leaf is visible. Lights can also traverse
  from their own leaf to find the leaves they reach (Doom 3 light/area interaction).

### Phase 4b: occluding doors (Doom 3 areaportals)

Doors must block vis when closed, without rebaking.

- **Authoring**: door brushes / meshes tagged `door_<name>` (editor brush kind in 2D and 3D,
  material/collection name in OBJ). Doors are *not* structural (the level must be baked
  with them open), like detail.
- **Compile**:
  1. Build the BSP without door geometry (doors open).
  2. Find the portals each door seals: portals whose winding lies inside the door's volume
     (or the leaves inside the door volume: their boundary portals). Tag them
     `portalDoor[p] = doorId`.
  3. Validate sealing: with the door's portals removed, the two sides must be disconnected
     in the portal graph (flood test). If not, warn: "door X does not seal, it will never
     occlude" (like a leak report).
  4. Bake the PVS with all doors open (conservative for every door state).
- **Runtime**: `portalOpen[p] = !doorClosed[portalDoor[p]]`; the traversal skips closed
  portals, so a closed door hides everything behind it. Partly open = open (conservative).
- **Extras**: closed doors also cut PAS/sound flood; export door → portal list.
- **Tests**: closed door ⇒ nothing behind it visible from in front (both dims); open door ⇒
  same as no door; non-sealing door reported.

## Phase 5: extras

- PAS: `computePas(pvs) → PvsTable` (one-bounce OR); export option; test PVS ⊆ PAS.
- Per-cluster draw lists from original triangles (OBJ path) for the runtime renderer.
- PVS export compression: zero-run RLE per row (Quake), on top of row/column sharing.
- WASM/SIMD for the antipenumbra clip: only if the bench shows the TS hot loop is the
  ceiling after phases 1–2.

## Order and expected payoff

| Phase | Effort | Payoff |
|---|---|---|
| 0 bench | S | required to judge everything |
| 1a sphere reject | S | modest, base vis + flow |
| 1b separator cache | M | likely largest flow win |
| 2a passage mightSee | M | fewer steps on deep chains |
| 3b clusters | M | big on large/OBJ levels |
| 3c column sharing | S | narrower rows, lossless |
| 1d allocation-free bitsets, 1e early-out | S | fewer allocations, less GC |
| 3e lossless leaf merging | S–M | fewer leaves/portals, exact |
| 3.5 incremental recompile | L | editor turnaround |
| 4 runtime clipping | L | runtime culling |
| 4b occluding doors | M | closed doors hide rooms, no rebake |
| 1c, 1f, 1g, 2b, 3a, 3d, 3f, 5 | S–M | situational, bench-driven |
