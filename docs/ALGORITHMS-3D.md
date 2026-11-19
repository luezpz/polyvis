# Algorithms

This document explains each compiler stage, the conventions that tie them together, and what
changed when porting from the 2D version. Source paths are relative to `src/`: shared stages live in `shared/core/`, 3D-specific code in `d3/core/`.

## Conventions (read this first)

| Concept | Representation | Convention |
|---|---|---|
| Plane | `Plane3 { n, d }` (`d3/core/math/plane3.ts`) | Points with `n·p = d`. **Front** = side the unit normal points to |
| Winding | `Winding = Vec3[]` (`d3/core/math/winding.ts`) | Convex, planar, **CCW seen from the front** (right-hand rule) |
| Wall | `Wall { winding, plane }` | Empty space in **front** |
| Brush | outward `planes` + derived `faces` (`d3/core/level/brush.ts`) | Inside = behind every plane |
| Leaf region | `ConvexPolyhedron` (`d3/core/math/polyhedron.ts`) | Faces with outward planes; `tag` = BSP plane index that produced the face (`BOUNDS_TAG` for the bounding box) |
| Directed portal | `Portal` | Leads `from` → `to`; plane normal points **into `to`**; winding CCW seen from `to` |
| BSP child ref | `number` | `>= 0` node index, `< 0` leaf `~ref` (= `-ref - 1`) |

The world is Z-up. All tolerances live in `shared/core/math/tolerance.ts`. "On a plane" means within
`PLANE_EPSILON`. Clipping (`clipWinding`) *discards* windings lying exactly on a clip plane: for
visibility, grazing contact cannot be seen through.

## 0. Brushes (`d3/core/level/brush.ts`)

A brush is a set of outward planes (Quake `.map` style), which makes any convex brush possible
(boxes, prisms, ramps). Faces are derived: each plane's large base winding is clipped by all
other planes; planes whose face vanishes are redundant and dropped; unbounded or zero-volume
plane sets are rejected. A second clipping pass with base windings sized to the brush keeps
vertices exact. Editing operations (translate, push a face) just change plane distances.

## 1. CSG: brushes → walls (`d3/core/csg/walls.ts`)

`empty = (∪ room brushes) − (∪ solid brushes)`.

1. **Fragment** every brush face by every other overlapping brush, Quake `ClipOutside` style:
   for each of the other brush's planes, the part in front is outside that brush and is kept as
   a piece; the rest continues. What survives all planes is inside (or on) the other brush.
   Each resulting piece has a uniform classification on both sides.
2. **Classify** each piece by probing just in front of and behind its centre (`PROBE_OFFSET`).
   Exactly one side empty → it is a wall, oriented with the empty side in front. Both sides
   empty (rooms touching/overlapping) or both solid → discarded.
3. **De-duplicate**: coincident faces of different brushes produce overlapping coplanar walls,
   sometimes cut differently. Coplanar same-facing walls are made disjoint by subtracting the
   walls accepted earlier (convex polygon difference by edge planes, the in-plane version of
   step 1), so every bit of the boundary is covered exactly once.

The result is watertight (`tests/d3/csg-bsp.test.ts` checks that Σ area·n = 0). Imported meshes
skip this stage (`d3/core/csg/meshWalls.ts`).

**Detail brushes.** A solid with `detail: true` is a non-cutting brush. The BSP is fed
`buildWalls(structural brushes)` only (`isStructural`: all rooms, solids not flagged), so detail
faces never split leaves and never occlude (the PVS only grows: still conservative).
`buildDetailWalls` runs the same CSG over **all** brushes and keeps the detail brushes' faces
(`CompileResult.detailWalls`), trimmed where they sink into other solids or leave the rooms. One
CSG with detail faces dropped afterwards is wrong: structural faces beneath the detail brush
(floor under a pillar) would be missing and the BSP would leak. Ignored on rooms.

## 2. Solid-leaf BSP (`shared/core/bsp/build.ts`)

Unchanged from 2D apart from the primitives:

- Candidate splitters are the distinct planes of the remaining fragments. Score =
  `splits × splitWeight + |front − back| × balanceWeight`; lowest wins.
- Fragments on the splitter facing the same way are **consumed** (a plane splits at most once
  on any root-to-leaf path). Opposite-facing coplanar fragments go back; spanning ones are split.
- No fragments left in front → **empty** leaf. None left behind → **solid** leaf.
- Each node carries its convex region: the bounding box (expanded by `boundsMargin`) clipped by
  all ancestor planes (`clipPolyhedron`: clip every face, add a cap face on the cutting plane
  tagged with its plane index). Leaves keep theirs.

**Empty-leaf refinement** (`shared/core/bsp/refine.ts`), in 3D:

- `cornerSplits` (default off, see NOTES.md): any wall that **touches the cell** (its polygon comes within `PROBE_OFFSET`
  of the cell, tested by clipping its vertices to the cell's faces pushed outwards; a single
  point or edge of contact counts) and whose plane cuts through the cell is a candidate; the
  most balanced wins. In 3D this captures vertical door jambs, lintels, balcony lips and the
  tops of low blocks, i.e. the reflex edges of the empty space where the view changes. The
  test is per cell, so splits stay local: a cell beside a doorway that meets the lintel only
  at a corner is still split by it, but walls elsewhere in the original leaf are not.
- `maxCellSize`: cells larger than this along x, y or z are halved by an axis-aligned plane.
- `minCellSize`: refinement splits leaving a side thinner than this are rejected. The 3D
  default is 1 (2D: 0.5), since cells, portals and flow time grow much faster in 3D.

**Parallel build** (`shared/core/bsp/parallelBuild.ts`): shared code, identical to 2D (see
ALGORITHMS-2D §2). Only the packing of walls and cells into flat messages is per dimension
(`d3/core/pack.ts`, `Geometry.pack*`).

**Leaf surfaces** (`shared/core/bsp/surfaces.ts`, Quake's marksurfaces): each wall is pushed down the tree
(split where it spans a plane; a wall lying on a plane goes to the side it faces), so every
empty leaf knows the wall pieces bounding it. The editor renders these; the export lists them.

## 3. Portals (`d3/core/portals/portals.ts`)

Two empty leaves are adjacent iff they have faces tagged with the same plane, one leaf in front
of it and the other behind. The portal is the **2D convex intersection** of the two faces on
that plane: one face is clipped by the inward edge planes of the other
(`intersectCoplanarWindings`). Tags make this exact, and T-junctions (one big face facing several
small leaves) fall out naturally. Every opening produces two directed portals (twins).

**Leaks** (`shared/core/portals/leaks.ts`): an empty leaf with a `BOUNDS_TAG` face touches the void; we
report it plus everything reachable from it, but keep compiling.

## 4. Base vis (`shared/core/vis/baseVis.ts`)

Unchanged: per portal *i*, the portals *j* partly in front of *i* with *i* partly behind *j*,
flood-filled from `i.to` (Golodetz Listings 4–5).

## 5. Portal flow (`shared/core/vis/portalFlow.ts`, `d3/core/vis/antipenumbra.ts`)

The same depth-first walk as in 2D, carrying `source`, `pass` and `might`. For each generator
portal *G*: clip `source` to the back of *G*; clip *G* to the front of *S*; clip *G* by the
separators of (`source`, `pass`); clip `source` by the separators of (*G*, `pass`).

**Separators in 3D** are planes through an **edge of one portal and a vertex of the other**,
built in both directions (edges of A × vertices of B and edges of B × vertices of A; Golodetz
Listing 2, Quake `ClipToSeperators`). A candidate is kept if the edge's portal lies strictly on
one side and the other portal entirely on the other side (touching allowed); it is oriented with
the pass portal in front. `clipToSeparators` clips the target as each separator is found and
stops as soon as it vanishes, which is much cheaper than building the full list. This is the
hot loop of the compiler and is written allocation-free.

Shrinking `source` and `pass` is conservative: any real sight line through the chain intersects
every clipped winding. Portals are processed in increasing "might see" size so finished results
prune later searches. `maxSteps` falls back to base vis if a level explodes combinatorially.

**Parallel flow** (`shared/core/vis/parallelFlow.ts`): shared and exact, as in 2D (see
ALGORITHMS-2D §5). 3D levels with near-total visibility (e.g. the "Oblique lattice" demo) give
long dependency chains and little concurrency.

## 6. Leaf PVS (`shared/core/vis/leafPvs.ts`)

Unchanged: `PVS(leaf) = {leaf} ∪ neighbours ∪ ⋃_{p ∈ portalsFrom(leaf)} { q.to | q ∈ portalVis[p] }`,
with optional `intersect`/`union` symmetry.

**Shared rows** (`shared/core/vis/pvsTable.ts`): many leaves have identical rows (every solid leaf has the
empty row; neighbouring cells often see exactly the same set). The table stores each distinct
row once plus `leafRow[leaf]`, an index into it. It is pure indirection: bits still index
leaves, the leaves stay convex, and decoding returns the original PVS bit for bit. The export
(format version 2) writes the row index on each leaf and only the distinct rows.

## Correctness checks

`tests/d3/vis.test.ts` samples random point pairs in random leaves of sample and randomly generated
3D levels (rooms wandering in x, y and z, with solid blocks); whenever the segment between them
crosses no wall polygon, the PVS **must** contain the target leaf. That invariant
(PVS ⊇ true visibility) is the definition of a correct PVS. The editor's "True line of sight"
layer shows the same thing interactively: rays from the probe, red dots would be misses.

`tests/d3/parallelBsp.test.ts` and `tests/d3/parallelFlow.test.ts` check the parallel stages
equal the sequential ones; `tests/d3/demos.test.ts` runs leak,
sight-line and conservativeness checks on the cheap demo levels.

## Mesh input (Blender)

`d3/core/import/obj.ts`: parse `v`/`f` (Y-up → Z-up optional; the rotation `(x, y, z) → (x, −z, y)`
preserves orientation), triangulate n-gons by ear clipping, weld duplicate vertices, then merge
coplanar triangles sharing an edge into convex polygons. Faces must point into the rooms (flip
normals otherwise). The faces go straight into the BSP; leaf regions are closed by the bounding
box, and leaks are reported, not fatal.

## What changed from 2D

| 2D | 3D (here) |
|---|---|
| `Vec2`, `Line2` | `Vec3`, `Plane3` |
| `Segment` (wall, portal) | convex polygon `Winding` |
| `clipSegmentFront` | `clipWinding` (Sutherland–Hodgman against a plane) |
| `ConvexPolygon` with edge tags | `ConvexPolyhedron`: faces with outward planes and tags |
| Brush = convex vertex loop | Brush = set of outward planes, faces derived |
| CSG: fragment edges at intersections | CSG: ClipOutside face fragmentation + coplanar subtraction |
| Corner splits: walls whose endpoint touches the cell | walls whose polygon touches the cell (point/edge contact counts) |
| Portals: interval overlap on a line | convex polygon intersection on a plane |
| Separators: endpoint × endpoint | edge × vertex, both directions |
| Leak: touches the bounding rectangle | touches the bounding box (6 faces) |
| Brush-only input | OBJ mesh import (`compileWalls` also accepts raw walls in 2D) |

Everything above the geometry layer (tree layout, portal graph, bitsets, base vis, flow
recursion, PVS assembly, row sharing) is one shared implementation in `src/shared/core`; the
two export formats share the same layout.
