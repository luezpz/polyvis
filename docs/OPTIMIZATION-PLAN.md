# Vis optimization plan

Goal: faster compile (tighter base vis, cheaper flow) and a runtime visibility layer
(Doom 3-style portal clipping, pre-baked PVS as prefilter). Background:
`docs/visibility-design-notes.md`.

Rules for every phase: shared code in `src/shared/core/vis` (generic over `Geometry<D>`),
both dimensions, LOS conservativeness tests must pass unchanged, one test per new option,
measure before/after with the phase 0 bench. Each phase is an option (default off) until the
bench shows a win, then flip the default.

## Re-baseline: corner splits off by default (2026-11-18)

`BspBuildOptions.cornerSplits` now defaults to `false` in both dimensions. The splits were meant
to tighten leaf PVS rows around convex corners, but they multiply leaves and portals and the
flow cost grows much faster than that. The old phase 0–3 tables (measured with corner splits on) were removed; numbers quoted in the
phase text below are from that setup and are stale. This section holds the same benchmarks
re-run with the new default. Σ pvs / Σ portalVis cannot be compared with the old tables,
because the tree and its units differ.

Defaults vs the old defaults (`npm run bench -- --all`, single-threaded, one run; old = "after
phase 1" timings):

| level | portals | base vis ms | flow ms | steps |
|---|---|---|---|---|
| 2d/Grid city 8×8 | 1504 → 630 | ~230 → 71 | ~290 → 87 | 84859 → 14044 |
| 2d/Maze 16×16 | 3316 → 1428 | ~1130 → 288 | ~215 → 54 | 52424 → 9818 |
| 2d/Pillar forest | 2684 → 1234 | ~760 → 217 | ~7400 → 1304 | 2085171 → 313490 |
| 2d/Oblique lattice | 1588 → 824 | ~250 → 98 | ~2400 → 606 | 888221 → 160178 |
| 3d/Grid city 6×6 | 1886 → 252 | ~650 → 13 | ~650 → 29 | 147259 → 2754 |
| 3d/Maze 10×10 | 396 → 396 | — | — | identical (no corner splits fire) |
| 3d/Pillar forest | 1120 → 528 | ~190 → 53 | ~2450 → 827 | 500438 → 124251 |
| 3d/Overlap pile | 540 → 300 | 57 → 99 (noise) | 814 → 298 | 187356 → 39541 |
| 3d/Oblique lattice | 1742 → 568 | 476 → 95 | 91530 (trunc) → **3132** | 20 M (trunc) → **579519** |

The 3D worst case no longer comes near `maxSteps`: it finishes in about 3 s instead of being
truncated after about 90 s. Flow is 3–20× faster on the heavy levels, and base vis is 2.5–50×
faster.

**Phase 2 passages, re-run.** `--all --passages` (single run), plus `--repeat 3` warm runs with
`--threads 1 / 4 / 11`. Σ pvs is identical to planes on every level, including 3D Oblique
lattice, which no longer truncates under either mode.

| level | Σ mightSee | steps | table ms 1t / 4t / 11t | flow ms planes → passages (warm) |
|---|---|---|---|---|
| 2d/Grid city 8×8 | 81781 → 57183 | 14044 → 12801 | 34 / 33 / 23 | 63 → 58 |
| 2d/Maze 16×16 | 18938 → 14639 | 9818 → 9352 | 14 / 13 / 14 | 42 → 44 |
| 2d/Pillar forest | 363049 → 333311 | 313490 → 242045 | 123 / 51 / 50 | 1154 → 979 |
| 2d/Oblique lattice | 161437 → 141276 | 160178 → 111749 | 66 / 43 / 34 | 502 → 392 |
| 3d/Grid city 6×6 | 14422 → 8163 | 2754 → 2190 | 15 / 14 / 16 | 14 → 12 |
| 3d/Pillar forest | 67168 → 61246 | 124251 → 109369 | 108 / 60 / 61 | 720 → 649 |
| 3d/Vent grille | 2256 → 1658 | 1642 → 1304 | 3 / 3 / 3 | 7 → 4 |
| 3d/Oblique lattice (cold) | 90889 → 87023 | 579519 → 274485 | 271 (1t) | 3132 → 1800 |

Verdict: the picture matches the old one, at a smaller scale. Single-threaded, base vis + table
+ flow is about even: 2D Pillar forest 1329 → 1267 ms, 2D Oblique lattice 589 → 537 ms, 3D
Pillar forest 765 → 800 ms, 3D Oblique lattice 3227 → 2173 ms, and slightly worse on the Grid
cities. With threads the table cost mostly disappears. Threads also parallelise base vis (2D
Maze 236 → 73 ms on 4 threads), so the editors' pool helps either mode. Passages stay opt-in.

**Phase 3b PVS clusters, re-run** (`--pvs-cluster`, defaults):

| level | leaves → clusters | Σ pvs → Σ cluster pvs |
|---|---|---|
| 2d/Grid city 8×8 | 494 → 218 | 11699 → 12015 (+3%) |
| 2d/Maze 16×16 | 1484 → 385 | 10629 → 11667 (+10%) |
| 2d/Pillar forest | 459 → 203 | 69682 → 75708 (+9%) |
| 2d/Serpentine | 80 → 38 | 173 → 175 |
| 2d/Oblique lattice | 260 → 148 | 20754 → 22034 (+6%) |
| 3d/Grid city 6×6 | 450 → 97 | 2514 → 2546 (+1%) |
| 3d/Maze 10×10 | 905 → 95 | 2683 → 2953 (+10%) |
| 3d/Tower | 142 → 19 | 685 → 745 (+9%) |
| 3d/Pillar forest | 301 → **2** | 17517 → 18496 (+6%) |
| 3d/Vent grille | 168 → 39 | 1012 → 1044 (+3%) |

The precision guard still caps the loss at about 10%. Without corner splits, 3D Pillar forest's
empty space is nearly mutually visible, so the guard lets it collapse into 2 clusters.

**Phase 3c column sharing:** column groups = distinct rows everywhere except 3D Pillar forest
(117 rows / 122 groups) and 3D Oblique lattice (47 / 48).

**Phase 3e convex leaf clusters, re-run** (`--all --cluster`, single run; leaf flow → cluster
flow):

| level | portals → flow portals | flow ms | steps | Σ pvs |
|---|---|---|---|---|
| 2d/Grid city 8×8 | 630 → 544 | 87 → 63 | 14044 → 12307 | 11699 → 25281 (+116%) |
| 2d/Maze 16×16 | 1428 → 1044 | 54 → 29 | 9818 → 5405 | 10629 → 11783 (+11%) |
| 2d/Pillar forest | 1234 → 1046 | 1304 → 771 | 313490 → 255397 | 69682 → 78921 (+13%) |
| 2d/Oblique lattice | 824 → 824 | — | no merges | identical |
| 3d/Grid city 6×6 | 252 → 240 | 29 → 20 | 2754 → 2440 | 2514 → 2546 (+1%) |
| 3d/Pillar forest | 528 → 448 | 827 → 687 | 124251 → 146674 | 17517 → 18253 (+4%) |
| 3d/Overlap pile | 300 → 284 | 298 → 149 | 39541 → 34917 | 2568 → 2640 (+3%) |
| 3d/Oblique lattice | 568 → 568 | — | no merges | identical |

Verdict unchanged: a draft-bake speed knob. There is less left to merge now, because most of the
old merges undid refinement splits.

**Phase 3f splitter heuristic, re-run** (`--bsp '{"facingWeight":4}'` vs defaults, single run):

| level | leaves | portals | flow ms | Σ pvs |
|---|---|---|---|---|
| 2d/Grid city 8×8 | 494 → 433 | 630 → 544 | ~65 → 58 | 11699 → 10376 |
| 2d/Maze 16×16 | 1484 → 1080 | 1428 → 1028 | ~45 → 24 | 10629 → 6049 |
| 2d/Pillar forest | 459 → 357 | 1234 → 850 | ~1150 → 491 | 69682 → 30522 |
| 3d/Grid city 6×6 | 450 → 299 | 252 → 240 | ~15 → 22 | 2514 → 2176 |
| 3d/Maze 10×10 | 905 → 584 | 396 → 396 | ~14 → 16 | 2683 → 2683 |
| 3d/Pillar forest | 301 → 157 | 528 → 252 | ~720 → 75 | 17517 → 3470 |
| 3d/Vent grille | 168 → 103 | 172 → 144 | ~7 → 0 | 1012 → 184 |

Verdict changed: corner splits used to hide most of the gain. Without them, `facingWeight: 4`
cuts portals and flow time on almost every level (3D Pillar forest flow is about 10× faster),
and only 3D Grid city is slightly slower. This makes it a candidate for the next default flip,
The LOS tests already cover it in both dimensions; check it on a big OBJ level (`--obj`) first.

## Phase 0: measure (prerequisite)

- `scripts/bench.ts` (run with `npx vite-node` or vitest bench): compile demo mazes + one large
  OBJ, report per stage: base vis ms, Σ|mightSee|, flow ms, steps, separator clips, final Σ|vis|.
- Add counters to `PortalFlowStats`: `separatorClips`, `classifyCalls` (cheap increments).
- Output: baseline table committed to this file.

**Status: done (2026-11-18).** `npm run bench` (`scripts/bench.mjs` → `scripts/bench.ts`, via Vite's
`runnerImport`); flags `--all` (adds edge cases + 3D Oblique lattice), `--only <substr>`,
`--obj <file>` (no large OBJ is in the repo; pass one). Counters added: `facetClips`
(steps 1–2) and `separatorClips` (steps 3–4) in `PortalFlowStats`. `classifyCalls` was dropped:
the flow never classifies, and base vis does at most 2 per ordered pair (≈ 2n², n = portals).

Observations:
- facet clips ≈ 2 × steps: step 1 (source behind G) almost never rejects, so 1a's sphere test
  and 1g's early reject should target steps 2–3, not 1.
- 3D Oblique lattice **hits `maxSteps` (20 M)** after ~118 s and falls back to base vis for the
  remaining sources: the flow is truncated there today, not merely slow.
- Base vis beats flow on sparse levels (2D Maze 16×16: 2.7 s vs 0.26 s; 3D Grid city: 1.2 s vs
  0.9 s): its O(n²) pair test is the target of 1a there.
- Flow dominates on open levels (Pillar forest, Oblique lattice): 1b / 1d / 2a.

## Phase 1: cheap hot-loop wins (Q2 / q3map2)

1a. **Bounding-sphere reject** (Q2 `portal->origin/radius`).
  - Precompute per portal `center: Vec<D>`, `radius`. In `portalMightSeePortal`:
    `signedDistance(pi.plane, cj) < -rj` → reject; `> rj` → Front without classifying.
  - Same quick test before each `clipFacet` in the flow (whole winding on one side).
  - Needs: `Geometry.facetCenterRadius` (or compute from `facetPoints`), contract test.
  **Status: base-vis half done (2026-11-18), on by default (exact).** `portalSpheres` +
  sphere branch in `portalMightSeePortal` (`computeBaseVis(g, graph, useSpheres = true)`); no new
  `Geometry` op (computed via `facetPoints`/`coords`/`vecAt`). Same Σ mightSee; base vis ms:
  2D Maze 16×16 2455 → 1113, 2D Pillar forest 1830 → 717, 3D Grid city 1077 → 676, 3D Pillar
  forest 357 → 170. Flow half (sphere test before `clipFacet`) not done: step 1 almost never
  rejects (phase 0), so gain is doubtful; measure first.
1b. **Separator caching** (q3map2 `stack->seperators`).
  - Separators of (source, pass) depend only on the frame, not the generator. Build once per
    recursion frame, then clip each generator against the list.
  - Split `clipToSeparators` into `separators(from, to): Plane[]` + `clipFacet` loop; both
    kernels; contract test that cached == uncached.
  - Caveat: with `clipSource`, the source is re-clipped per generator; cache only for the
    unclipped-source case or key the cache on the source winding identity.
  **Status: done (2026-11-18), on by default (exact).** `Geometry.separators` +
  `clipFacetToPlanes` (both kernels, same plane order as `clipToSeparators`); `flowFromSource`
  caches step 3's separators per frame and uses them whenever step 1 returns the source object
  unchanged (`clipFacet` returns the same object when nothing is cut), so `clipSource` needs no
  special case. Option `flow.cacheSeparators` (single-threaded API; workers always cache). Same
  counters and Σ; flow ms vs 1d/1e: 2D Pillar forest 8628 → 7403, 2D Oblique lattice 3172 → 2447,
  2D Grid city 361 → 288; 3D only ~2–8% (3D Pillar forest 2610 → 2571, Grid city 723 → 663): the
  3D lazy separator walk already stops early, and step 4 (per generator, not cacheable) remains.
1c. **Winding pooling** (Q1 stack windings): only if the bench shows GC time. Deferred.
1d. **Allocation-free bitsets in the flow.** `might.and(...)` allocates a BitSet per step:
  use one preallocated row per recursion depth, and fuse `and` + `hasAnyNotIn(vis)` into one
  word loop that returns "anything new".
1e. **Source early-out**: stop a source as soon as `vis == mightSee[source]` (nothing left to
  find). Cheap word compare at each set.
  **Status 1d + 1e: done (2026-11-18), always on (exact: identical results).** `BitSet.andInto`
  (fused and + "anything new"), one row per depth in `flowFromSource`. Bench: same counters and
  Σ everywhere; flow ms −10–17% (2D Pillar forest 9974 → 8628, 3D Pillar forest 2919 → 2610,
  3D Grid city 858 → 723). 1e never fires on the bench levels (the last new bit is found on the
  last useful step), kept since it costs one word loop per newly visible portal.
1f. **Flat portal storage in workers** (SoA typed arrays for windings/planes, like
  `bsp/pack.ts`), so the hot loop reads numbers instead of objects. Only if the bench shows
  object access dominating.
1g. **Separator order / early reject**: test the generator against the source and pass
  planes before building separators; test the separators most likely to clip first (last
  one that clipped, Quake-style heuristics).

**Phase 1 summary (2026-11-18): 1a (base vis half), 1b, 1d, 1e done; all exact.** `npm run bench
-- --all` after phase 1 matches the phase 0 baseline in every non-timing column on all 26 levels
(portals, Σ mightSee, steps, clips, Σ portalVis, Σ pvs; 3D Oblique lattice still truncates at the
same step).

Left open, bench-driven: 1a flow half, 1c, 1f, 1g. The 3D flow is now dominated by step 4
(per-generator reverse antipenumbra) and by step count: phase 2a is next.

## Phase 2: tighter base vis (q3map2 passage vis)

2a. **Tightened mightSee** (default candidate).
  - For each portal p and each t ∈ portalsFrom[p.to] ∩ mightSee[p]:
    `canSee(p,t) = { k ∈ mightSee[p] ∩ mightSee[t] : clipToSeparators(p.w, t.w, k.w) ≠ null }`.
  - `mightSee'[p] = ∪_t ({t} ∪ canSee(p,t))`, then re-run the flood. Uses 1b's cached
    separators (one set per (p,t)).
  - New module `vis/passages.ts`; pipeline option `basevis: "planes" | "passages"`.
  - Parallel: one task per p on the existing worker pool (rows are independent).
  - Tests: mightSee' ⊆ mightSee; final PVS identical (flow is exact either way).
  **Status 2a + 2b: done (2026-11-18), option `baseVis: "passages"`, default stays `"planes"`.**
  2a alone was nearly useless (first attempt: steps −1% at best, more on open levels): the flow
  already rejects those portals at depth 2 for one clip. The win needs 2b, so both ship together:
  `computePassages` builds a flat `PassageTable` (one canSee row per (p, t), q3map2
  `CreatePassages`, sphere pre-tests per clip, exact), `passageMightSee` derives 2a's rows, and the
  flow ANDs canSee(pass, gen) into `might` at every step (`PortalFlowOptions.passages`; parallel
  workers get the table in `begin`). Two findings:
  - **Order by base vis** (`PortalFlowOptions.orderBy`): sorting sources by the tighter rows
    reorders them, costs steps (2D Pillar forest +5%) and changes Σ portalVis both ways. Sorted
    by base rows, the result is bit-identical to the plain flow on every bench level except 3D
    Oblique lattice (which no longer truncates).
  - Memory: slots (Σ out-degree) × portals bits, dense, no cap (removed 2026-11-18). E.g. 20k
    portals × 6 out-portals ≈ 300 MB. TODO: sparse rows if big OBJ levels need it.

  Σ portalVis / Σ pvs identical everywhere except 3D Oblique lattice: 761912 → 750377 /
  69876 → 69245 (it now finishes instead of falling back to base vis). Net: big win on the
  worst case, small win on 2D Pillar forest / Oblique lattice, neutral 3D Pillar forest, loss on
  Grid cities (the table build costs more than the flow saves).

  **Parallel table build: done (2026-11-18).** `computePassagesParallel` (`vis/parallelPassages.ts`):
  rows of p are independent (`createPassageRows(p0, p1)`), so portal ranges of equal estimated
  cost (`passageCosts`: (out-degree + 1) × (|mightSee| + 1), ×3 in 3D) go to workers, ~8 chunks
  per worker, handed out on demand; bit-identical table (tested for 1/2/5 workers). Editors: the
  compile worker's pool (`shared/app/compile/rowPool.ts`, `runners.passages` of
  `compileLevelAsync`); bench: `--threads <n>` (Node `worker_threads`, `scripts/benchWorker.*`).
  Two fixes were needed before threads paid off:
  - **Packed inputs**: cloning the object graph cost ~10 ms *per worker*, serialized on the
    sender (2D Maze 16×16: 53 ms single vs 98 / 157 ms on 4 / 11 threads). Now
    `packPortalGraph` + `BitSet.packRows` (typed arrays, memcpy clones): warm begin 2–9 ms.
  - **Thread count by cost** (`MIN_COST_PER_THREAD` = 400k units ≈ 20 ms): small tables build
    locally with no workers at all; others use ⌊cost / 400k⌋ threads at most.

  Row building scales ~3–5×, not 11× (load imbalance at the tail, likely ~6 physical cores).
  With threads, passages win or tie on every heavy level except 2D Grid city (+11%); tiny levels
  differ by a few ms. Still opt-in: single-threaded `compileLevel` (tests, Node) pays the full
  table cost. Candidate next step: flip the default in the editors only (where the pool exists).
2b. **Full passage rows in flow** (done with 2a, see above).
  - Keep `canSee(p,t)` rows; flow at depth ≥ 2: `newMight &= canSee(pass, gen)`.
  - Open: sparse rows (store only rows strictly tighter than mightSee[t]) to cut memory.

## Phase 3: smaller graph

3a. **Portal merging**: coplanar portals between the same leaf pair whose union is convex.
  **Status: no-op on the leaf graph (2026-11-18).** Two convex leaves touch on one plane in one
  convex facet, and portal discovery emits one portal per (leaf pair, plane): there is never more
  than one portal per pair. It would only matter between 3e clusters (several leaf portals from
  one cluster into the same neighbour); needs a facet-union `Geometry` op. Not done.
3b. **Clusters** (lossy, fewer units).
  - Merge leaves joined by wide portals (area ≥ ~0.5 × leaf cross-section, tune) plus leaves
    split only by refinement. `leafCluster[leaf]` → cluster id.
  - Export PVS per cluster: source row = OR of its leaves' rows, bits = clusters.
  - Flow on leaves (exact, then cluster at export) or on clusters (faster, looser): option.
  - Tests: cluster PVS ⊇ leaf PVS mapped to clusters; LOS tests via leaf → cluster lookup.
  **Status: done as option `pvsCluster: "wide"` (2026-11-18), default `"none"`.** Flow on leaves
  (exact as before; `pvs` unchanged), clustering at export: `vis/pvsClusters.ts`
  (`buildPvsClusters` → `CompileResult.pvsClusters`: `leafCluster`, `count`, cluster `pvs`, and its
  3c `table`). Non-convex clusters are fine since no flow runs on them. Merge candidates: portals
  with measure ≥ `minWidth` × the smaller leaf's largest boundary piece (new `Geometry.facetMeasure`:
  2D length, 3D area), and refinement-split portals; widest first. Findings:
  - The width test alone barely discriminates (corridor portals span the full cross-section;
    `minWidth` 0.5 and 0.9 give the same clusters) and costs up to 3× Σ visible (Serpentine,
    Grid city 2.5×).
  - Fix: **precision guard** `maxGrowth` (default 0.1). The leaf PVS is known, so a merge is refused
    when n·|P_A ∪ P_B| > (1 + maxGrowth)·(E_A + E_B) (E = exact Σ |pvs[l]| of the leaves). It must
    compare with the exact sums: a first version compared with the previous cluster rows, the
    growth compounded and 3D Pillar forest collapsed to 2 clusters at 0.25.

  `minWidth: 2` (refinement merges only) with the guard: tighter (3D Maze 905 → 200 at exact Σ),
  fewer merges elsewhere. `--pvs-cluster '{json}'` tunes it. Open: export layout for clusters
  (with 3c's export bump), flow on clusters (that is 3e).
3c. **Keep PVS indirection, extend it** (lossless, same units; stacks on clusters).
  - `PvsTable` stays: dedup rows of whatever the unit is (leaves or clusters); clustering
    saturates rows, so duplicates get more common, not less.
  - Add column sharing: group units with identical columns, store one bit per group,
    `unitColumn[unit]` → group. Decoding stays bit-exact.
  - Order: cluster (optional) → dedup rows → share columns.
  **Status: done in core (2026-11-18), always built (lossless).** `buildPvsTable` adds
  `leafColumn` + `columnRows` (rows narrowed to one bit per column group); `pvsTableSees(t, a, b)`
  decodes; tests check bit-exact decoding against `pvs` in both dims. Finding: groups = distinct
  rows on every bench level except 3D Oblique lattice (178 rows / 218 groups, truncated flow): the
  leaf PVS is (near) symmetric, so identical columns ⇔ identical rows. The payoff is width:
  rows × leaves → rows × groups bits, e.g. 2D Maze 16×16 1282 × 2104 → 1282 × 1282, 3D Maze
  10×10 151 × 905 → 151 × 151, 3D Comb 32 × 187 → 32 × 32. Bench prints `leaves | pvs rows |
  pvs columns`. Not yet in the export (it still writes wide rows): a next-version layout with
  `leafColumn` per leaf is the open step.
3d. **Hint walls** (`hint_` material/brush): split planes that are never solid.
3e. **Lossless leaf merging**: after the BSP, merge two empty leaves sharing a portal when
  their union is convex (exact: no vis is lost). Fewer leaves and portals for the flow.
  **Status: done as option `cluster: "convex"` (2026-11-18), default `"none"`. Not lossless.**
  `portals/clusters.ts` (`buildLeafClusters`, greedy over portal ids, union-find) merges two
  clusters when no boundary piece (outgoing portal or wall surface, plane facing out) of one lies
  in front of a boundary plane of the other, i.e. the union is a convex cell. Base vis, passages and
  flow run on the cluster graph; `vis/clusterRows.ts` maps the rows back to leaf portals, so
  `graph`, `mightSee`, `portalVis`, `pvs`, the export and the editors are unchanged
  (`CompileResult.clusters` gives `leafCluster` and the flow portal count). Findings:
  - The plan's "exact" was wrong: each leaf gets its cluster's PVS, the union of its leaves' rows.
    Leaves split by refinement exist to tighten rows, so merging undoes it. Leaf flow is not exact
    either, so cluster PVS ⊇ leaf PVS does not hold per leaf; only the LOS tests apply.
  - Portal convexity alone (q3map2 `TryMergeLeaves`) is sound for the flow's no-re-entry rule
    (`onChain`) but collapses walled corridors into one cluster (Serpentine, Comb: everything
    visible). Wall surfaces in the test fix that.
  - `clusterOptions.acrossRefinement` (default false): merging across refinement splits (detected
    as LCA nodes with only empty leaves below) too. Neither mode dominates: across: 2D Pillar
    forest flow 1700 ms / Σ pvs 510k, 3D Grid city 253 ms / 67k; without: 4091 ms / 421k and
    480 ms / 101k (greedy merge order matters).

  With `--passages` too, 3D Oblique lattice finishes in 8.4 M steps / 41 s (passages alone:
  12.5 M / 69 s), Σ pvs 71684. Verdict: up to 2× faster flow for +10–100% Σ pvs: a draft-bake
  speed knob, not a default. Next ideas if pursued: a precision guard (refuse merges whose leaves'
  base-vis rows differ much), better merge order (largest portal first).
3f. **Splitter heuristic**: score BSP candidate planes by portals/leaves created (not only
  walls split); sample candidates on big levels to keep the build fast.
  **Status: done as BSP options (2026-11-18), both off by default.** `scoreSplitters` adds
  `− facingWeight·onPlane` (fragments on the candidate plane, consumed by the node: Quake's
  "facing" count); `splitCandidates(frags, maxCandidates)` takes an evenly spaced sample. Both
  live in the shared scoring, so the parallel build stays identical (tested). Scoring by portal
  area created was skipped: it needs a region ∩ plane op per candidate per node.
  Verdict: fewer leaves everywhere (up to 2×, mostly solid/coplanar fragments), but portal count
  and flow time are mixed (Grid cities worse, 3D Pillar forest −30% flow). Σ pvs is not comparable
  across different trees (different units). Weight 1 is neutral; 16 ≈ 4. `maxCandidates` (16) saved
  nothing measurable: the BSP is 2–10% of compile time on these levels; it is for big OBJ levels.
  Kept opt-in; revisit with a large OBJ (`--obj`).

## Phase 3.5: editor turnaround

- **Incremental recompile**: after an edit, rebuild only the BSP subtrees and portals whose
  bounds touch the change; rerun flow only for sources whose mightSee reaches changed
  portals; reuse cached rows for the rest. Biggest win for editing, not for final bakes.

  **Status: flow reuse done in core (2026-11-18); verdict: small payoff, CSG is the bottleneck.**
  `vis/incrementalFlow.ts` (`computePortalFlowIncremental`, `FlowCache`), driven by
  `compileSession()` (both dims; single-threaded, not wired into the editors). Portals match
  across compiles by exact geometry (`portalKey`: plane + `packFacet` numbers). Source i's old
  row is reused only if everything `flowFromSource` reads for it maps one-to-one: M = mightSee[i],
  leaf identities of M's portals, `portalsFrom[leaf] ∩ M` in order, rank relations to i, and each
  member's known/mightSee row inside M. Checked in flow order, so the result is bit-identical to a
  fresh flow (tested on every sample level and two edits, both dims). Off with passages, changed
  flow options, or after truncation. Measured (one solid/room face moved by 0.1, single-threaded):

  | level | portals | matched | reused | flow ms inc / fresh |
  |---|---|---|---|---|
  | 2d/Maze 16×16 | 1428 | 1424 | 1402 | 33 / 39 |
  | 2d/Grid city 8×8 | 630 | 628 | 346 | 56 / 56 |
  | 2d/Pillar forest | 1248 | 1096 | 332 | 955 / 1056 |
  | 2d/Oblique lattice | 824 | 646 | 70 | 438 / 423 |
  | 3d/Maze 10×10 | 396 | 294 | 81 | 22 / 16 |
  | 3d/Grid city 6×6 | 252 | 108 | 0 | 19 / 15 |

  Findings:
  - The BSP is mostly stable in 2D (80–99% of portals match) even without incremental BSP;
    3D less so (27–90%): the global splitter choice reshuffles more.
  - Open levels: most sources' mightSee reaches the edit, so few rows qualify, and the ones that do
    are the cheap ones (Pillar forest: 27% reused, −10% flow).
  - Closed levels reuse nearly everything, but there the flow is already the cheapest stage:
    2D Maze 16×16 timings are csg 1260 | bsp 107 | base vis 211 | flow 60 ms. The check overhead
    eats the gain on small graphs.
  - (Superseded below: CSG got a BVH.) So the editor turnaround was bound by **CSG** (then base vis, BSP), not flow. Next steps, in
    order: profile/speed up CSG (per-brush caching: a brush's clipped faces only change if a
    brush overlapping its bounds changed); reuse base vis rows the same way (row i depends on all
    portals' planes, so needs a bounds-based argument, not exact matching); incremental BSP only
    if 3D matching rates matter after that. Flow reuse is kept (exact, cheap) but not a priority.

  **CSG broad phase (2026-11-19), always on.** Following three-bvh-csg (BVH to find candidate
  triangle pairs), `shared/core/spatial/bvh.ts` is a BVH over boxes (any dimension, plain numbers;
  queries return ids ascending so order-dependent 3D fragmentation is unchanged). Both CSGs use it
  to find the brushes that can cut an edge/face and for the empty-space probes (rooms and solids
  indexed separately). 2D had no culling at all (O(edges × brush edges)). Walls are identical
  (checked by snapshot of every level, both dims). `buildWalls` ms:

  | level | brushes | before | after |
  |---|---|---|---|
  | 2d/Maze 16×16 | 511 | 1223 | 44 |
  | 2d/Grid city 8×8 | 176 | 189 | 23 |
  | 2d/Pillar forest | 132 | 100 | 10 |
  | 3d/Maze 10×10 | 199 | 69 | 44 |
  | 3d/Grid city 6×6 | 96 | 35 | 22 |

  Per-brush CSG caching is no longer worth it (CSG is now < 10% of a compile).
  `npm run bench` (default set) before → after: every non-timing column identical; total ms 2D Maze
  16×16 1633 → 398, 2D Grid city 8×8 328 → 177, 3D Maze 10×10 200 → 170, others within noise.

  **Incremental base vis (2026-11-19), in `compileSession()`.** `vis/incrementalBaseVis.ts`; shared
  matching in `vis/portalMatch.ts` (`portalKeyIds`, `matchPortals`, `LeafBinder`). Row i is a
  flood from `to(i)` through portals passing rules 1 + 2, which read only the two portals'
  geometry. So the old row is reused when every portal leaving a leaf the old flood visited is
  matched, the leaves correspond one-to-one, and no visited leaf gained portals: O(frontier) per row
  instead of n plane tests. Bit-identical (tests: every sample level × 2 edits × plain / `cluster:
  "convex"` / passages, both dims). After one edit (warm, single-threaded, ms incremental / fresh):

  | level | portals | base vis reused | base vis ms | flow reused | flow ms | compile ms |
  |---|---|---|---|---|---|---|
  | 2d/Maze 16×16 | 1428 | 1402 | 29 / 280 | 1402 | 42 / 48 | 255 / 504 |
  | 2d/Grid city 8×8 | 630 | 314 | 40 / 49 | 346 | 61 / 73 | 145 / 171 |
  | 2d/Pillar forest | 1248 | 329 | 266 / 243 | 332 | 1290 / 1311 | 1611 / 1614 |
  | 2d/Oblique lattice | 824 | 57 | 107 / 97 | 70 | 548 / 572 | 689 / 707 |
  | 3d/Grid city 6×6 | 252 | 0 | 11 / 9 | 0 | 21 / 20 | 105 / 104 |
  | 3d/Maze 10×10 | 396 | 81 | 19 / 21 | 81 | 19 / 19 | 200 / 184 |

  Findings: closed levels gain 2× overall; open levels stay flow-bound (rows reach the edit).
  The check costs up to ~10% when little is reused. 3D reuse is limited by BSP instability (3D Grid
  city: 108 / 252 portals match), and the BSP is now the largest stage on closed levels (2D Maze
  ~100 ms, 3D Maze ~80 ms).
  **Paused here (2026-11-19): editor turnaround is low priority.** Open, if resumed: (1) wire `compileSession` into the editors' compile worker
  (it is single-threaded: either use it only for small edits, or feed reused rows to the parallel
  runners as pre-finished sources); (2) a stable/incremental BSP (reuse subtrees whose fragments
  are unchanged; a stable splitter choice so a local edit does not reshuffle the root splits).

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

**Status (2026-11-20): done** (in `src/shared/core/runtime/`, bound per dimension in `d{2,3}/core/runtime/`).
- Query `visibleLeaves(graph, cameraLeaf, eye, { clip, view, frustum, pvsRow, portalOpen })`, two modes:
  - `"planes"` (precise, default): each portal winding is clipped to the current frustum, and the next
    frustum is the cone through the *clipped* winding (`Geometry.portalFrustum`), so a frustum stays a
    plain plane list instead of needing frustum intersection.
  - `"rect"` (cheap, Doom 3): the winding is projected to a screen rect (`projectRect`) and intersected
    with the current one. A winding straddling the eye plane keeps the current rect (conservative).
  Without a `view`, planes mode is omnidirectional and rect mode is the union over a cube map of 90°
  views (`axisViews`). Leaves are not visited once (each path has its own frustum/rect); only
  re-entering a leaf on the current path is cut. Camera: `View` (forward, screen axes, tangent rect),
  `viewToward` per dimension, `viewFrustum` for the planes mode.
- Culling: `leavesInBounds(tree, box)` (BSP walk, register an object once per move), `anyVisible`,
  `lightLeaves` (omnidirectional query from the light ∩ its radius box; closed doors block light).
- Export: `packRuntime(graph, pvsTable, closed)` → typed arrays (CSR leaf → portals, planes, winding
  vertices, `portalClosed`, shared PVS rows). The JSON/text export files are v3: each portal also carries
  its `plane` (normal into `to`) and a `closed` flag (`exportPvs*(result, closed)`), so an engine can run the
  traversal from the file alone. Column sharing (3c) would need another format bump.
- Editor: layers "Runtime portal clipping (probe)" and "Runtime clip: cheap rect mode". PVS leaves the
  query culls are orange. 3D "probe from camera" uses the real camera frustum; other probes are
  omnidirectional. Checked in headless Chrome (no console errors).
- Tests (`tests/d*/runtime.test.ts`, contract in `tests/shared`): both modes ⊆ PVS row and never miss a
  ray-visible leaf in the view; planes ⊆ rect; rect is looser somewhere; closed portals block;
  culling and export round-trip.
- Subsumption cut: a leaf is not re-entered with a frustum / rect contained in one it already had
  (same apex, so nothing new is reachable). Without it 3D Pillar forest queries hung (> 10 min for
  64 eyes); with it 0.7 ms per query.
- Bench: `npm run bench -- --runtime [--exact-pvs] [--verbose]` (`scripts/benchRuntime.ts`): 64 seeded
  eyes per level, four modes (planes / rect × omnidirectional / 90° camera): mean and max µs,
  visible leaves, portal crossings. The flow is capped at 200 k steps so heavy levels compile fast
  (truncated levels use the base-vis PVS, marked "(base)"); the default set runs in ~5 s.
  Findings: planes cam 8–260 µs; omnidirectional rect is *slower* than omnidirectional planes
  (6 cube views, 2–5× the crossings); through a camera, rect costs about the same as planes but
  keeps more leaves. Rect only pays off where clipping a winding costs more than a box test.
- Example (2D Grid city 8×8, leaf centroid, omnidirectional): PVS 46 leaves, rect 13, planes 7.
  3D Grid city 6×6, camera view: PVS 27, rect 15, planes 3.

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
- **Extras**: export door → portal list. Sound: engines flood the portal graph from the source and
  attenuate or stop at door portals (no PAS, see phase 5).
- **Tests**: closed door ⇒ nothing behind it visible from in front (both dims); open door ⇒
  same as no door; non-sealing door reported.

**Status (2026-11-19): done for brushes** (`src/shared/core/doors/`, both dims).
- Authoring: `Brush.door` (name; solid only; brushes sharing a name are one door), saved in the level
  JSON, editor buttons "Make door" / "Not a door" plus a name field. Non-structural like detail.
- Compile: instead of teaching the (parallel) BSP builder about doors, a post-pass `splitLeavesByDoors`
  splits each empty leaf overlapping a door volume along its planes (only empty leaves are subdivided, so
  the PVS stays conservative). `findDoors`: door leaves = centroid inside the volume; door portals = those
  crossing the leaf set's boundary; `seals` = the leaves around the door fall into ≥ 2 components without
  it. Non-sealing doors are listed as errors in the compile panel. New stages: "door splits", "doors".
- Runtime: `doorPortalOpen(portalCount, result.doors, closedNames)` → `portalOpen` for `visibleLeaves` /
  `lightLeaves`; `closedDoorPortals` → `packRuntime` / export `closed` flags. Editor layer
  "Runtime clip: close all doors". Demo level "Doors" (2D + 3D). Checked in headless Chrome.
- Tests (`tests/d*/doors.test.ts`): leaves wholly in/out of the door, sealing / non-sealing, closed door
  hides the far room while open shows it, PVS conservative w.r.t. ray-tested sight lines, serialization,
  export `closed` flags.
- Open: OBJ `door_<name>` meshes; door → portal list in the export files.

## Phase 5: extras

- ~~PAS~~ dropped (2026-11-19): a baked artifact that can't be rebuilt at map load, and not needed.
  Sound runs on the portal graph at runtime instead, with door portals attenuating or stopping it.
- Export items (per-cluster draw lists, zero-run RLE rows, column sharing in the file, door → portal
  list) moved out (2026-11-19): export gets its own plan.
- WASM/SIMD for the antipenumbra clip: only if the bench shows the TS hot loop is the
  ceiling after phases 1–2.

## Order and expected payoff

| Phase | Effort | Payoff |
|---|---|---|
| corner splits off by default (done) | S | flow 3–20×, base vis 2.5–50× on heavy levels; 3D Oblique lattice 90 s (trunc) → 3 s |
| 0 bench (done) | S | required to judge everything |
| 1a sphere reject (base vis done) | S | base vis 2–2.5× |
| 1b separator cache (done) | M | flow −15–23% 2D, −2–8% 3D |
| 2a + 2b passages + parallel table (done, option) | M | steps −3–37%, total −7–23% on open levels with threads; 3D Oblique lattice no longer truncates |
| 3b PVS clusters (done, option) | M | 2–10× fewer PVS units for ≤ +10% Σ visible (precision guard) |
| 3f splitter heuristic (done, option) | S | without corner splits: portals −5–50%, flow up to 10× faster; default-flip candidate |
| 3c column sharing (done in core; export v3 open) | S | rows 1.2–6× narrower, lossless |
| 1d allocation-free bitsets, 1e early-out (done) | S | flow −10–17% |
| 3e convex leaf clusters (done, option) | S–M | flow up to 2× faster, Σ pvs +10–100%: draft bakes |
| 3.5 CSG BVH (done), incremental base vis + flow (done in core, `compileSession`) | M | CSG up to 28× faster; closed levels recompile 2× faster after an edit; editor wiring + stable BSP open |
| 4 runtime clipping (done: planes + rect modes, culling, typed-array + v3 file export, editor layer) | L | runtime culling: e.g. PVS 46 → 7 leaves |
| 4b occluding doors (done for brushes; OBJ doors open) | M | closed doors hide rooms, no rebake |
| 3a (no-op on leaves) | S | none on the bench levels |

### Leftovers (open, in suggested order)

| Phase | Effort | Payoff |
|---|---|---|
| BSP splitter sweep (done 2026-11-19, exact, always on) | S | BSP 2D Maze 93 → 31 ms, 3D Maze 78 → 42 ms, 2D Grid city 29 → 17 ms; same trees |
| flow hot-loop arithmetic (done 2026-11-19, exact) | S | 3D `clipWinding` scratch buffer: flow 3D Pillar forest ~600 → ~430 ms; 2D separators inlined, hypot skipped by a squared pre-check: 2D flow ~2.3× faster (Pillar forest 976 → 416 ms) |
| 3.5 stable BSP (stable splitter choice, reuse unchanged subtrees) | M–L | BSP is the largest stage on closed levels (2D Maze ~100 ms, 3D Maze ~80 ms); repeatable results across re-imports, and more 3D incremental reuse (Grid city 108 / 252 portals match today) |
| 1g separator order / early reject | S | targets step 4, the 3D flow hot spot; bench-driven |
| 1f flat portal storage in workers | M | fewer object reads in the flow; also tells whether WASM is worth it |
| 4 runtime coherence (reuse last frame's result inside the same leaf, cache static-light results) | S | cuts worst-case frames (planes cam 8–260 µs per query) |
| 3d hint walls (`hint_` material in the OBJ) | S–M | tighter PVS and faster flow on open levels, placed in Blender |
| 1a flow half (sphere test before `clipFacet`) | S | doubtful: step 1 almost never rejects |
| 1c winding pooling | S | only if the profile shows GC time |
| 5 WASM/SIMD antipenumbra clip | L | only if 1f shows the arithmetic is the ceiling |

**BSP splitter sweep (2026-11-19).** Profile: splitter scoring was 78% of the build (O(candidates ×
fragments) per node). `bsp/sweep.ts` scores each group of ≥ 4 candidates sharing an exact (or negated)
normal at once: per fragment, the min / max of `n·p` decide front / back for every offset (rounding of
`x − d` is monotone), so counts are binary searches over sorted extremes; "on" fragments come from a window
over thin fragments. Bit-identical scores (`tests/shared/bspSweep.test.ts`, both kernels, incl. jitter
within the eps band); bench portals and Σ pvs unchanged. Now 3D BSP time: region clipping
(`clipPolyhedron`, mostly the cap winding) ~46%, scoring ~35%. Making the clip cheaper changes region
numerics (not bit-identical), so it is left open.
