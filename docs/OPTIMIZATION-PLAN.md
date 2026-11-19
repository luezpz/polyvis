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

**Status: done (2026-11-18).** `npm run bench` (`scripts/bench.mjs` → `scripts/bench.ts`, via Vite's
`runnerImport`); flags `--all` (adds edge cases + 3D Oblique lattice), `--only <substr>`,
`--obj <file>` (no large OBJ is in the repo; pass one). Counters added: `facetClips`
(steps 1–2) and `separatorClips` (steps 3–4) in `PortalFlowStats`. `classifyCalls` was dropped:
the flow never classifies, and base vis does at most 2 per ordered pair (≈ 2n², n = portals).

Baseline (single-threaded Node 26, one run, `--all`; edge cases with no portals omitted):

| level | portals | base vis ms | Σ mightSee | flow ms | steps | facet clips | separator clips | Σ portalVis | Σ pvs |
|---|---|---|---|---|---|---|---|---|---|
| 2d/Grid city 8×8 | 1504 | 545 | 408058 | 403 | 84859 | 169718 | 154684 | 76596 | 43720 |
| 2d/Maze 16×16 | 3316 | 2671 | 80250 | 262 | 52424 | 104848 | 87856 | 46036 | 33839 |
| 2d/Pillar forest | 2684 | 1610 | 1717614 | 9974 | 2085171 | 4170342 | 3640971 | 691076 | 359021 |
| 2d/Serpentine | 152 | 7 | 514 | 1 | 406 | 812 | 440 | 334 | 563 |
| 2d/Comb | 160 | 6 | 5560 | 20 | 5560 | 11120 | 10564 | 5560 | 5801 |
| 2d/Slit wall | 120 | 4 | 2662 | 12 | 2578 | 5156 | 4680 | 2138 | 1911 |
| 2d/Oblique lattice | 1588 | 667 | 583538 | 3830 | 888221 | 1775612 | 1406154 | 205746 | 74959 |
| 2d/Overlap pile | 88 | 2 | 1819 | 9 | 2399 | 4796 | 3864 | 1768 | 624 |
| 2d/Islands | 16 | 0 | 40 | 0 | 40 | 80 | 48 | 40 | 63 |
| 2d/Round room | 128 | 4 | 1466 | 4 | 1303 | 2606 | 2041 | 1272 | 593 |
| 2d/Needle | 6 | 0 | 6 | 0 | 6 | 12 | 4 | 6 | 16 |
| 2d/Far from origin | 12 | 0 | 26 | 0 | 26 | 52 | 24 | 26 | 45 |
| 3d/Grid city 6×6 | 1886 | 1211 | 444235 | 858 | 147259 | 294518 | 270737 | 125972 | 49998 |
| 3d/Maze 10×10 | 396 | 44 | 4566 | 12 | 2288 | 4576 | 3544 | 2088 | 2683 |
| 3d/Tower | 536 | 89 | 11421 | 70 | 13324 | 26641 | 22506 | 10440 | 4647 |
| 3d/Pillar forest | 1120 | 407 | 296424 | 2919 | 500438 | 1000876 | 862433 | 168552 | 76099 |
| 3d/Serpentine | 104 | 3 | 346 | 1 | 274 | 548 | 296 | 226 | 383 |
| 3d/Comb | 120 | 4 | 3120 | 14 | 3120 | 6240 | 5824 | 3120 | 3301 |
| 3d/Vent grille | 496 | 72 | 51768 | 193 | 50410 | 100820 | 83166 | 27776 | 12480 |
| 3d/Oblique lattice | 1742 | 1134 | 856051 | 117809 | 20000001 (trunc) | 39982702 | 28695056 | 761912 | 69876 |
| 3d/Edge & corner kiss | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| 3d/Overlap pile | 540 | 88 | 70416 | 1084 | 187356 | 374352 | 299017 | 67980 | 7984 |
| 3d/Islands | 96 | 3 | 1848 | 6 | 1856 | 3712 | 3176 | 1848 | 673 |
| 3d/Round room | 96 | 3 | 839 | 2 | 768 | 1536 | 1124 | 744 | 369 |
| 3d/Needle | 12 | 0 | 26 | 0 | 26 | 52 | 24 | 26 | 36 |
| 3d/Far from origin | 32 | 0 | 150 | 0 | 150 | 300 | 192 | 150 | 139 |

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
same step). Timings, same machine, single run (ms, baseline → after):

| level | base vis | flow |
|---|---|---|
| 2d/Grid city 8×8 | 545 → ~230 | 403 → ~290 |
| 2d/Maze 16×16 | 2671 → ~1130 | 262 → ~215 |
| 2d/Pillar forest | 1610 → ~760 | 9974 → ~7400 |
| 2d/Oblique lattice | 667 → ~250 | 3830 → ~2400 |
| 3d/Grid city 6×6 | 1211 → ~650 | 858 → ~650 |
| 3d/Pillar forest | 407 → ~190 | 2919 → ~2450 |
| 3d/Overlap pile | 88 → 57 | 1084 → 814 |
| 3d/Oblique lattice | 1134 → 476 | 117809 → 91530 (trunc) |

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

  Bench (`npm run bench -- --all --passages`; "base vis ms" = base + passage table; planes →
  passages; timings = 2 runs, single-threaded):

  | level | Σ mightSee | steps | base vis ms | flow ms |
  |---|---|---|---|---|
  | 2d/Grid city 8×8 | 408058 → 333996 | 84859 → 78820 | ~230 → ~330 | ~300 → ~295 |
  | 2d/Maze 16×16 | 80250 → 70731 | 52424 → 50881 | ~1020 → ~1050 | ~205 → ~225 |
  | 2d/Pillar forest | 1717614 → 1549352 | 2085171 → 1755139 | ~700–870 → ~1080–1220 | ~7000–7650 → ~6450 |
  | 2d/Oblique lattice | 583538 → 514121 | 888221 → 589002 | 251 → 432 | 2332 → 1895 |
  | 3d/Grid city 6×6 | 444235 → 387468 | 147259 → 132954 | ~630 → ~950 | ~620 → ~600 |
  | 3d/Pillar forest | 296424 → 271308 | 500438 → 412033 | ~190 → ~510 | ~2440 → ~2130 |
  | 3d/Vent grille | 51768 → 44892 | 50410 → 38022 | 42 → 90 | 169 → 148 |
  | 3d/Overlap pile | 70416 → 69726 | 187356 → 129490 | 61 → 176 | 830 → 645 |
  | 3d/Oblique lattice | 856051 → 835274 | 20 M (trunc) → **12499401** | 489 → 1724 | 89523 (trunc) → **68677** |

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

  Warm bench (`--repeat 3`, 12-core machine; table ms; total = base vis + table + flow, best of
  4/11 threads; Σ pvs identical for 1/4/11 threads and to planes):

  | level | table 1t | 4t | 11t | planes total | passages total |
  |---|---|---|---|---|---|
  | 2d/Grid city 8×8 | 116 | 51 | 48 | 517 | 573 |
  | 2d/Maze 16×16 | 43 | local | local | 1261 | 1203 |
  | 2d/Pillar forest | 440 | 173 | 149 | 8086 | **7535** |
  | 2d/Oblique lattice | 179 | 65 | 53 | 2696 | **2235** |
  | 3d/Grid city 6×6 | 352 | 126 | 115 | 1292 | 1310 |
  | 3d/Pillar forest | 364 | 109 | 75 | 3043 | **2349** |
  | 3d/Vent grille | 50 | 28 | 28 | 210 | 212 |
  | 3d/Oblique lattice (cold, 1 run) | 1263 | | 413 | 90012 (trunc) | **66116** |

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

  Bench (`npm run bench -- --pvs-cluster`, defaults; leaves include solid ones; Σ cluster pvs =
  Σ over empty leaves of leaves in visible clusters, comparable to Σ pvs):

  | level | leaves → clusters | Σ pvs → Σ cluster pvs |
  |---|---|---|
  | 2d/Grid city 8×8 | 755 → 377 | 43720 → 45720 (+5%) |
  | 2d/Maze 16×16 | 2104 → 738 | 33839 → 36999 (+9%) |
  | 2d/Pillar forest | 897 → 447 | 359021 → 391678 (+9%) |
  | 2d/Serpentine | 118 → 76 | 563 → 563 |
  | 2d/Oblique lattice | 467 → 324 | 74959 → 79303 (+6%) |
  | 3d/Grid city 6×6 | 854 → 344 | 49998 → 54040 (+8%) |
  | 3d/Maze 10×10 | 905 → 95 | 2683 → 2953 (+10%) |
  | 3d/Pillar forest | 469 → 151 | 76099 → 83719 (+10%) |
  | 3d/Vent grille | 254 → 60 | 12480 → 13736 (+10%) |

  `minWidth: 2` (refinement merges only) with the guard: tighter (3D Maze 905 → 200 at exact Σ),
  fewer merges elsewhere. `--pvs-cluster '{json}'` tunes it. Open: export layout for clusters
  (with 3c's v3), flow on clusters (that is 3e).
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
  pvs columns`. Not yet in the export (v2 still writes wide rows): a v3 layout with
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

  Bench (`npm run bench -- --all --cluster`, default mode, single-threaded; Σ mightSee/portalVis
  columns are over expanded leaf rows, not comparable; baseline = after phase 1):

  | level | portals → flow portals | flow ms | steps | Σ pvs |
  |---|---|---|---|---|
  | 2d/Grid city 8×8 | 1504 → 1118 | ~290 → 191 | 84859 → 54175 | 43720 → 88714 |
  | 2d/Maze 16×16 | 3316 → 2296 | ~215 → 84 | 52424 → 25909 | 33839 → 49775 |
  | 2d/Pillar forest | 2684 → 2038 | ~7400 → 3739 | 2085171 → 1238072 | 359021 → 421458 |
  | 2d/Oblique lattice | 1588 → 1344 | ~2400 → 1732 | 888221 → 705005 | 74959 → 91647 |
  | 3d/Grid city 6×6 | 1886 → 1646 | ~650 → 524 | 147259 → 149971 | 49998 → 101314 |
  | 3d/Pillar forest | 1120 → 922 | ~2450 → 1807 | 500438 → 397632 | 76099 → 85269 |
  | 3d/Oblique lattice | 1742 → 1482 | 91530 (trunc) → 75503 (trunc) | 20 M → 20 M | 69876 → 71937 |

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
  Bench (`npm run bench -- --bsp '{"facingWeight":4}'`, single run, timings noisy):

  | level | leaves | portals | flow ms | Σ pvs |
  |---|---|---|---|---|
  | 2d/Grid city 8×8 | 755 → 737 | 1504 → 1592 | 333 → 460 | 43720 → 47584 |
  | 2d/Maze 16×16 | 2104 → 1900 | 3316 → 3292 | 222 → 273 | 33839 → 34494 |
  | 2d/Pillar forest | 897 → 839 | 2684 → 2548 | 7883 → 8478 | 359021 → 310586 |
  | 3d/Grid city 6×6 | 854 → 711 | 1886 → 1900 | 670 → 854 | 49998 → 50520 |
  | 3d/Maze 10×10 | 905 → 584 | 396 → 396 | 16 → 18 | 2683 → 2683 |
  | 3d/Pillar forest | 469 → 357 | 1120 → 980 | 2735 → 1933 | 76099 → 60806 |
  | 3d/Serpentine | 151 → 72 | 104 → 104 | 1 → 1 | 383 → 383 |

  Verdict: fewer leaves everywhere (up to 2×, mostly solid/coplanar fragments), but portal count
  and flow time are mixed (Grid cities worse, 3D Pillar forest −30% flow). Σ pvs is not comparable
  across different trees (different units). Weight 1 is neutral; 16 ≈ 4. `maxCandidates` (16) saved
  nothing measurable: the BSP is 2–10% of compile time on these levels; it is for big OBJ levels.
  Kept opt-in; revisit with a large OBJ (`--obj`).

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
| 0 bench (done) | S | required to judge everything |
| 1a sphere reject (base vis done) | S | base vis 2–2.5× |
| 1b separator cache (done) | M | flow −15–23% 2D, −2–8% 3D |
| 2a + 2b passages + parallel table (done, option) | M | steps −3–37%, total −7–23% on open levels with threads; 3D Oblique lattice no longer truncates |
| 3b PVS clusters (done, option) | M | 2–10× fewer PVS units for ≤ +10% Σ visible (precision guard) |
| 3f splitter heuristic (done, option) | S | up to 2× fewer leaves; portals/flow mixed |
| 3c column sharing (done in core; export v3 open) | S | rows 1.2–6× narrower, lossless |
| 1d allocation-free bitsets, 1e early-out (done) | S | flow −10–17% |
| 3e convex leaf clusters (done, option) | S–M | flow up to 2× faster, Σ pvs +10–100%: draft bakes |
| 3.5 incremental recompile | L | editor turnaround |
| 4 runtime clipping | L | runtime culling |
| 4b occluding doors | M | closed doors hide rooms, no rebake |
| 1c, 1f, 1g, 3a (no-op on leaves), 3d, 5 | S–M | situational, bench-driven |
