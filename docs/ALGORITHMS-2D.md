# Algorithms

This document explains each compiler stage, the conventions that tie them together, and what
changes when moving from 2D to 3D. Source paths are relative to `src/`: shared stages live in `shared/core/`, 2D-specific code in `d2/core/`.

## Conventions (read this first)

| Concept | 2D representation | Convention |
|---|---|---|
| Plane | `Line2 { n, d }` (`d2/core/math/line2.ts`) | Points with `n·p = d`. **Front** = side the unit normal points to |
| Wall / face | `Segment` + `Line2` | Oriented a→b, **empty space on the left = front** |
| Leaf region | `ConvexPolygon` | CCW; `tags[i]` = index of the BSP plane that produced edge i (`BOUNDS_TAG` for the bounding box) |
| Directed portal | `Portal` | Leads `from` → `to`; normal points **into `to`**; segment has `to` on its left |
| BSP child ref | `number` | `>= 0` node index, `< 0` leaf `~ref` (= `-ref - 1`) |

All tolerances live in `shared/core/math/tolerance.ts`. "On a plane" means within `PLANE_EPSILON`.
Clipping *discards* parts lying exactly on a clip plane: for visibility, grazing contact cannot be
seen through.

## 1. CSG: brushes → walls (`d2/core/csg/walls.ts`)

`empty = (∪ room brushes) − (∪ solid brushes)`.

1. **Fragment** every brush edge at every intersection with other brushes' edges and at other
   brushes' vertices lying on it. Collinear overlapping edges end up cut into identical pieces.
2. **Classify** each piece by probing just left and right of its midpoint
   (`PROBE_OFFSET`). Exactly one side empty → it is a wall, oriented with the empty side in front.
   Both sides empty (rooms touching/overlapping) or both solid → discarded. This removes the
   interior faces between rooms.
3. **De-duplicate** identical pieces (coincident edges of two brushes).
4. **Merge** collinear touching same-facing pieces so the BSP sees long walls.

The result is always watertight. Non-CSG input (imported meshes) can bypass this stage via
`compileWalls()`.

**Detail brushes.** A solid with `detail: true` is a non-cutting brush. The BSP is fed
`buildWalls(structural brushes)` only (`isStructural`: all rooms, solids not flagged), so detail
faces never split leaves and never occlude (the PVS only grows: still conservative).
`buildDetailWalls` runs the same CSG over **all** brushes and keeps the detail brushes' faces
(`CompileResult.detailWalls`), trimmed where they sink into other solids or leave the rooms. One
CSG with detail faces dropped afterwards is wrong: structural faces beneath the detail brush
(floor under a pillar) would be missing and the BSP would leak. Ignored on rooms.

## 2. Solid-leaf BSP (`shared/core/bsp/build.ts`)

Recursive build over wall fragments:

- Candidate splitters are the distinct planes of the remaining fragments. Score =
  `splits × splitWeight + |front − back| × balanceWeight`; lowest wins.
- Fragments on the splitter facing the same way are **consumed** (this is what de-duplicates
  coplanar walls: a plane splits at most once on any root-to-leaf path). Opposite-facing
  coplanar fragments go back; spanning ones are split.
- No fragments left in front → **empty** leaf. None left behind → **solid** leaf.

**Empty-leaf refinement** (`shared/core/bsp/refine.ts`, all in `BspBuildOptions`). A plain solid-leaf BSP
lets one big cell wrap around a convex solid corner (pillar, door jamb, inner corner of an L),
so its PVS row is everything visible from *either* side. Instead of closing an empty region as a
leaf straight away, the builder keeps splitting it:

- `cornerSplits` (default off, see NOTES.md) — any wall whose endpoint touches the region and whose line passes through its
  interior (i.e. the wall's extension past the corner) is a candidate; the most balanced one
  wins. These lines are where the view around a corner changes, so cells bounded by them get
  much tighter PVS rows.
- `maxCellSize` — regions wider/taller than this are halved by an axis-aligned line
  (`0` = off), like qbsp's block grid.
- `minCellSize` — refinement splits that would leave a side thinner than this along the split
  normal are rejected (prevents slivers). Wall splits are never affected.

Refinement only subdivides empty space, so leaf contents and conservativeness are unchanged. More
cells mean more portals, so flow time grows roughly with the cell count.

Each node carries its convex region (the bounding box, expanded by `boundsMargin`, clipped by all
ancestor planes); leaves keep theirs. The bounding box keeps regions finite even when the level
leaks.

**Parallel build** (`shared/core/bsp/parallelBuild.ts`) yields the same tree as `buildBsp`. The
two children of a node are independent once its fragments are partitioned, so `buildBsp` itself
is one subtree task plus `assembleTree`, which splices subtrees in preorder and renumbers their
refinement planes (`Geometry.retagCell`). Splitter scoring costs O(candidates × fragments), so
the levels near the root dominate and farming out subtrees alone caps the speed-up near 2x.
Instead the main thread walks the top of the tree and, at each big node, every worker scores one
chunk of candidate planes (lowest score wins, ties to the earliest chunk = the sequential
choice). Small nodes and empty regions become subtree tasks, run after the top walk, largest
first. Messages are flat arrays (`bsp/pack.ts`); fragments are never sent, workers re-derive
them by repeating the parent's partition. The editors use it from 300 walls with at most 4
threads (`shared/app/compile/bspPool.ts`); more threads were slower (serial setup dominates).
Caveat: plane interning is tolerance-based, so two nearly equal planes could intern differently.

## 3. Portals (`d2/core/portals/portals.ts`)

Two empty leaves are adjacent iff they have edges tagged with the same plane, one leaf in front of
it and the other behind. The portal is the overlap of those two edges' intervals along the plane.
Tags make this exact: no fuzzy collinearity tests, and T-junctions (one long leaf edge facing
several small leaves) fall out naturally.

Every opening produces two directed portals (twins). Graph: nodes = leaves, edges = directed
portals (`portalsFrom[leaf]`).

**Leaks** (`shared/core/portals/leaks.ts`): an empty leaf with a `BOUNDS_TAG` edge touches the void. We
report it plus everything reachable from it (Quake's outside flood), but keep compiling.

## 4. Base vis (`shared/core/vis/baseVis.ts`)

Cheap conservative "might see" set per portal *i* (Golodetz Listings 4–5):

1. *j* must be partly in front of *i*;
2. *i* must be partly behind *j* (portals are looked through from behind);
3. flood fill from `i.to` along portals passing 1 and 2.

## 5. Portal flow (`shared/core/vis/portalFlow.ts`, `d2/core/vis/antipenumbra.ts`)

Depth-first walk from each source portal *S* through the graph, carrying:

- `source` — the part of *S* that can still see down the chain,
- `pass` — the visible part of the latest portal,
- `might` — the intersection of "might see" sets along the chain (prunes the search).

For each generator portal *G* leaving the current leaf:

1. clip `source` to the back of *G*;
2. clip *G* to the front of *S*;
3. clip *G* by the separators of (`source`, `pass`) — the **antipenumbra**;
4. clip `source` by the separators of (*G*, `pass`) — the **reverse antipenumbra**.

If *G* survives, *S* sees *G*; recurse through *G* with the clipped windings. That is the
"source portal + target portal → clip a third portal" idea: if the third portal is clipped away
entirely, nothing beyond it along that chain can be visible.

**Separators in 2D** are lines through one endpoint of each portal with the remaining endpoints
strictly on opposite sides — at most two, crossing between the portals. In 3D they are planes
through an edge of one portal and a vertex of the other, built in both directions.

Shrinking `source` and `pass` is conservative: any real sight line through the chain intersects
every clipped winding. Portals are processed in increasing "might see" size so finished results
(`portalVis`) can replace `mightSee` for pruning, as Quake does. A `maxSteps` safety valve falls
back to base vis if a pathological level explodes combinatorially.

**Parallel flow** (`shared/core/vis/parallelFlow.ts`) gives exactly the same `portalVis`. Source
*i* reads finished rows only for portals in its `might` set, which is a subset of `mightSee[i]`,
so it depends exactly on

    deps(i) = { j ∈ mightSee[i] : rank(j) < rank(i) }    (rank = position in the flow order)

and is dispatched as soon as those are finished, together with their rows (batches of up to
`MAX_BATCH` = 8 ready sources per call). Workers ignore rows of later sources via `rank`.
Mutually invisible areas run concurrently; open levels form a near-chain and run nearly serially
(still correct). Exactness only breaks when `maxSteps` is hit, since the budget is checked at
dispatch. The editors use cores − 1 workers (max 16) from 200 portals
(`shared/app/compile/flowPool.ts`); smaller graphs, or no nested-worker support, use one thread.

## 6. Leaf PVS (`shared/core/vis/leafPvs.ts`)

`PVS(leaf) = {leaf} ∪ neighbours ∪ ⋃_{p ∈ portalsFrom(leaf)} { q.to | q ∈ portalVis[p] }`.

Optional symmetry: since both directions are conservative, `intersect` (A sees B only if B sees A)
remains conservative and is slightly tighter; `union` is the most defensive.

Leaf surfaces (`shared/core/bsp/surfaces.ts`) and shared PVS rows (`shared/core/vis/pvsTable.ts`)
are the same shared code as in 3D; see [ALGORITHMS-3D.md](ALGORITHMS-3D.md). The 2D export
(`d2/core/export/pvsExport.ts`, format version 2) uses both.

## Correctness checks

`tests/d2/vis.test.ts` samples random point pairs in random levels; whenever the straight segment
between them crosses no wall, the PVS **must** contain the target leaf. That invariant (PVS ⊇ true
visibility) is the definition of a correct PVS. The editor's "True line of sight" layer shows the
same thing interactively.

`tests/d2/parallelBsp.test.ts` and `tests/d2/parallelFlow.test.ts` check the parallel stages
(with in-process workers) give results equal to the sequential ones; `tests/d2/demos.test.ts`
runs leak, sight-line and conservativeness checks on the cheap demo levels.

## 2D vs 3D

Only the geometry kernel, CSG, portal discovery and separator construction differ; see the
"What changed from 2D" table in [ALGORITHMS-3D.md](ALGORITHMS-3D.md).
