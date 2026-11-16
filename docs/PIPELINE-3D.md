# The 3D pipeline in pseudocode

A line-by-line walkthrough of how a 3D level becomes a PVS. The pseudocode is simplified; the
real code is in the files named in each section. For the reasoning behind each stage, see
[ALGORITHMS-3D.md](ALGORITHMS-3D.md).

## Contents

0. [Overview and vocabulary](#overview-and-vocabulary)
1. [Entry points](#1-entry-points)
2. [Brushes](#2-brushes)
3. [CSG: brushes → walls](#3-csg-brushes--walls)
4. [Mesh import (OBJ)](#4-mesh-import-obj)
5. [Solid-leaf BSP](#5-solid-leaf-bsp)
6. [Empty-leaf refinement](#6-empty-leaf-refinement)
7. [Leaf surfaces](#7-leaf-surfaces)
8. [Portals](#8-portals)
9. [Leaks](#9-leaks)
10. [Base vis](#10-base-vis)
11. [Portal flow](#11-portal-flow)
12. [Separators (antipenumbra)](#12-separators-antipenumbra)
13. [Leaf PVS](#13-leaf-pvs)
14. [Shared rows](#14-shared-rows)
15. [Export and runtime use](#15-export-and-runtime-use)
16. [How correctness is checked](#16-how-correctness-is-checked)

---

## Overview and vocabulary

```text
brushes ─CSG─▶ walls ─BSP─▶ leaves ─portals─▶ graph ─base vis─▶ mightSee ─flow─▶ portalVis ─▶ PVS ─▶ export
OBJ mesh ──────▶ walls ┘
```

| Term | Meaning |
|---|---|
| **Plane** `{n, d}` | Points `p` with `n·p = d`, where `n` is a unit vector. The **front** is where `n·p − d > 0`. |
| **Winding** | A convex planar polygon (`Vec3[]`), counter-clockwise when seen from the front. |
| **Wall** | A winding plus its plane. Empty space is in front, solid is behind. |
| **Leaf** | A convex cell of the BSP. It is either *empty* (you can stand in it) or *solid*. |
| **Region** | The convex polyhedron of a node or leaf. Each face is **tagged** with the index of the BSP plane that made it. |
| **Portal** | The opening between two adjacent empty leaves. It is directed `from → to`, and its normal points into `to`. |
| **PVS** | For each leaf, the set of leaves possibly visible from anywhere inside it (a bitset). |

The world is Z-up. All epsilons live in `shared/core/math/tolerance.ts`.

---

## 1. Entry points

Files: `src/shared/core/pipeline.ts`, `src/d3/core/pipeline.ts`

```text
 1  function compileLevel(level, opts):
 2      walls = CSG(level.brushes) + meshWalls(level.meshes)
 3      return compileWalls(walls, opts)
 4
 5  function compileWalls(walls, opts):
 6      tree      = buildBsp(walls, opts.bsp)
 7      surfaces  = buildLeafSurfaces(tree, walls)
 8      graph     = buildPortalGraph(tree)
 9      leaks     = detectLeaks(tree, graph)
10      mightSee  = computeBaseVis(graph)
11      portalVis = computePortalFlow(graph, mightSee, opts.flow)
12      pvs       = computeLeafPvs(tree, graph, portalVis, opts.symmetry)
13      table     = buildPvsTable(pvs)
14      return { walls, tree, surfaces, graph, leaks,
15               mightSee, portalVis, pvs, table, stats, timings }
```

| Line | Explanation |
|---|---|
| 1 | Main entry point. A `level` is an immutable value holding brushes (and optionally mesh walls). `opts` can override the BSP options, the flow options and the PVS symmetry mode. |
| 2 | Turns the authored solids into **walls**, the one input every later stage understands. Brushes go through CSG (§3); imported meshes are already walls (§4). |
| 3 | Everything after the walls doesn't depend on the input format, so it lives in a separate function. |
| 5 | Second entry point. Use it directly for raw or non-CSG walls; the input may leak. |
| 6 | Partitions space into convex cells, each marked empty or solid (§5–6). |
| 7 | Records which wall pieces bound each empty leaf. Used for rendering and export (§7). |
| 8 | Finds the openings between adjacent empty leaves (§8). This step is 3D-specific code. |
| 9 | Finds empty space that reaches the outer bounding box (§9). It reports leaks but doesn't stop the compile. |
| 10 | A cheap, coarse estimate of which portals each portal *might* see (§10). |
| 11 | The expensive, exact-enough step: shrinks those sets using real 3D geometry (§11–12). |
| 12 | Converts portal-to-portal visibility into leaf-to-leaf visibility (§13). |
| 13 | Deduplicates identical PVS rows for a smaller export (§14). |
| 14–15 | Returns every intermediate result, so the editor can show each stage as a layer. In the real code, each stage is wrapped in `timed(...)` for the stats panel. |

**Where it runs:** the editor (`3d.html` → `src/d3/app`) sends the level to a Web Worker through
`CompileClient`. The worker calls `compileLevel` and posts back the result by structured clone.
`shared/app/compile/protocol.ts` (`hydrateResult`) turns the plain objects back into `BitSet`
instances.

---

## 2. Brushes

File: `src/d3/core/level/brush.ts`

```text
 1  function brushFaces(planes):
 2      faces = []
 3      for each plane P in planes:
 4          w = hugeBaseWinding(P)
 5          for each other plane Q in planes:
 6              w = clipWinding(w, keep back of Q)
 7          if w is empty: mark P redundant
 8          else faces += (P, w)
 9      if brush is unbounded or has zero volume: reject
10      repeat 3–8 with base windings sized to the brush
11      return faces
```

| Line | Explanation |
|---|---|
| 1 | A brush is stored as a list of **outward planes**, like a Quake `.map` file. The inside is behind every plane. This allows any convex shape: boxes, prisms, ramps. |
| 3–4 | Each plane gets a very large square lying on it, the "base winding". |
| 5–6 | Clipping by every other plane keeps only the part inside the brush. What's left is exactly this plane's face. |
| 7 | If nothing is left, the plane doesn't touch the brush's surface, so it is redundant and dropped. |
| 8 | Otherwise the plane and its polygon become a face. |
| 9 | A brush missing a side (unbounded) or flat (no volume) is invalid. |
| 10 | Huge base windings lose float precision. A second pass, starting from windings only slightly bigger than the brush, gives exact vertices. |
| 11 | Faces are *derived* data. Edits such as translating or pushing a face only change plane distances, and the faces are rebuilt. |

---

## 3. CSG: brushes → walls

File: `src/d3/core/csg/walls.ts`

Rule: **empty = (union of room brushes) − (union of solid brushes)**. A wall is any piece of a
brush face that has empty space on exactly one side.

### 3a. Fragmentation

```text
 1  pieces = []
 2  for each brush B:
 3      for each face F of B:
 4          frags = [F]
 5          for each other brush C whose bounds overlap F:
 6              newFrags = []
 7              for f in frags:
 8                  rest = f
 9                  for each plane P of C:
10                      newFrags += front(rest, P)
11                      rest      = back(rest, P)
12                  newFrags += rest
13              frags = newFrags
14          pieces += frags
```

| Line | Explanation |
|---|---|
| 2–3 | Every face of every brush is a candidate wall. |
| 4 | Start with the whole face; it gets cut into smaller pieces. |
| 5 | Only brushes that could overlap the face matter (bounding-box test). |
| 8–11 | Quake's `ClipOutside`. Walk the planes of brush C. The part of the piece *in front* of a plane is definitely outside C, so it becomes a finished piece. The part behind continues to the next plane. |
| 12 | What survives all of C's planes is inside or on C, and is kept as its own piece. |
| 13 | Repeat with the next overlapping brush. |
| 14 | The result: every piece is entirely inside or entirely outside each other brush, so classification is uniform across each piece. |

### 3b. Classification

```text
15  walls = []
16  for each piece p:
17      c = centroid(p)
18      frontEmpty = isEmpty(c + p.n * PROBE_OFFSET)
19      backEmpty  = isEmpty(c - p.n * PROBE_OFFSET)
20      if frontEmpty XOR backEmpty:
21          walls += orient(p, emptySideInFront)
22
23  function isEmpty(point):
24      return inside some room brush AND not inside any solid brush
```

| Line | Explanation |
|---|---|
| 17–19 | Probe a tiny distance in front of and behind the piece's centre. Because of step 3a the whole piece behaves the same as its centre. |
| 20 | Empty on exactly one side means a boundary between air and solid. Both sides empty (two rooms touching) or both solid (buried face) means no wall. |
| 21 | Flip the winding if needed, so the convention "empty in front" holds. |
| 23–24 | The CSG rule from above, evaluated at one point. |

### 3c. Coplanar de-duplication

```text
25  accepted = []
26  for w in walls:
27      for a in accepted where a is coplanar with w and faces the same way:
28          w = w − a          // convex polygon difference, may split into several
29      accepted += remaining pieces of w
30  return accepted
```

| Line | Explanation |
|---|---|
| 27 | Two brushes sharing a face produce two overlapping walls on the same plane, sometimes cut differently. |
| 28 | Subtract the walls already accepted, using their in-plane edges as clip lines. This is step 3a again, one dimension lower. |
| 30 | Every bit of the boundary is now covered exactly once, so the output is **watertight** (Σ area·n = 0, checked in `tests/d3/csg-bsp.test.ts`). |

---

## 4. Mesh import (OBJ)

Files: `src/d3/core/import/obj.ts`, `src/d3/core/csg/meshWalls.ts`

```text
1  function meshWalls(objText, yUp):
2      verts, faces = parse "v" and "f" lines
3      if yUp: verts = map (x, y, z) → (x, −z, y)
4      tris  = earClip(each face)
5      tris  = weldDuplicateVertices(tris)
6      polys = mergeCoplanarNeighbours(tris)   // keep only convex results
7      return polys as walls                    // skip CSG
```

| Line | Explanation |
|---|---|
| 2 | A minimal OBJ parser: positions and faces only. |
| 3 | Blender exports Y-up; the compiler is Z-up. This rotation keeps triangle winding (and therefore facing) intact. |
| 4 | Splits n-gons into triangles (they may be concave). |
| 5 | Merges vertices at the same position so neighbouring triangles share edges. |
| 6 | Joins coplanar triangles that share an edge back into larger convex polygons. Fewer, bigger walls give a smaller BSP. |
| 7 | Faces must point **into** the rooms (flip normals in Blender if not). There is no CSG, so gaps become leaks (§9). |

---

## 5. Solid-leaf BSP

File: `src/shared/core/bsp/build.ts` (shared with 2D)

```text
 1  function build(frags, region):
 2      S = argmin over distinct planes of frags of
 3              splits(S) * splitWeight + |nFront − nBack| * balanceWeight
 4      F, B = [], []
 5      for f in frags:
 6          if   f lies on S and faces like S:    discard (consumed)
 7          elif f lies on S and faces opposite:  B += f
 8          elif f spans S:                       F += front(f, S); B += back(f, S)
 9          elif f is in front of S:              F += f
10          else:                                 B += f
11      frontRegion = clipPolyhedron(region, keep front of S, capTag = index(S))
12      backRegion  = clipPolyhedron(region, keep back of S,  capTag = index(S))
13      node.front  = F empty ? emptyLeaf(frontRegion) : build(F, frontRegion)
14      node.back   = B empty ? solidLeaf(backRegion)  : build(B, backRegion)
15      return node
16
17  tree = build(walls, boundingBox(walls).expand(boundsMargin))
```

| Line | Explanation |
|---|---|
| 1 | `frags`: wall pieces still to place. `region`: the convex cell this subtree covers. |
| 2–3 | Pick the splitting plane among the walls' own planes. Each split creates extra fragments, and an unbalanced tree is deep; the two weights trade these off. |
| 6 | Walls on the splitter facing the same way are fully represented by the node, so they are used up. This guarantees termination: each plane splits at most once on a root-to-leaf path. |
| 7 | An opposite-facing wall on the same plane (a thin slab) still has to bound the back subtree. |
| 8 | A wall crossing the plane is cut in two. |
| 9–10 | Otherwise it goes whole to one side. |
| 11–12 | Clip the region by the plane. Each face is clipped and a new **cap** face is added on the cut, tagged with the plane's index. These tags make portal discovery exact (§8). |
| 13 | No walls left in front: walls face their empty side outward, so that space is **empty**. |
| 14 | No walls left behind: that space is **solid**. This is what "solid-leaf" BSP means; every leaf is purely one or the other. |
| 17 | The root region is the walls' bounding box, slightly enlarged. Its six faces are tagged `BOUNDS_TAG`. |

Child refs: `>= 0` is a node index, `< 0` is a leaf stored as `~leafIndex`.

---

## 6. Empty-leaf refinement

File: `src/shared/core/bsp/refine.ts`

```text
 1  for each empty leaf L (worklist):
 2      cands = walls w such that
 3                w comes within PROBE_OFFSET of L.region
 4            and plane(w) cuts through L.region
 5      S = most balanced of cands                      // cornerSplits
 6      if no S and L.extent on x/y/z > maxCellSize:
 7          S = axis-aligned plane halving L            // size split
 8      if S and both halves are ≥ minCellSize thick:
 9          replace L by node(S, emptyLeaf, emptyLeaf)
10          push both halves on the worklist
```

| Line | Explanation |
|---|---|
| 1 | Plain BSP leaves can be huge and see "around corners". Splitting them makes the PVS tighter. |
| 2–4 | A wall touching the cell whose plane slices through it marks a **reflex edge**: a door jamb, lintel, balcony lip or block top, where what you can see changes. The touch test clips the wall against the cell's faces pushed slightly outward. |
| 5 | Of several candidates, take the one splitting the cell most evenly. |
| 6–7 | Optional `maxCellSize`: very large open cells are halved along an axis. |
| 8 | `minCellSize` (3D default 1, 2D 0.5) stops slivers. Cell count, portal count and flow time grow fast in 3D. |
| 9–10 | Both halves are empty; repeat until no rule applies. |

---

## 7. Leaf surfaces

File: `src/shared/core/bsp/surfaces.ts`

```text
1  for each wall w:
2      push(w, root)
3  function push(piece, ref):
4      if ref is a leaf: surfaces[~ref] += piece; return
5      S = plane(ref)
6      if piece on S: push(piece, facing(piece, S) ? front : back)
7      elif spans S:  push(front(piece,S), front); push(back(piece,S), back)
8      else:          push(piece, side)
```

| Line | Explanation |
|---|---|
| 1–2 | Quake's *marksurfaces*: find which leaves each wall bounds. |
| 4 | Reaching a leaf stores the piece there. |
| 6 | A wall lying on a split plane belongs with the side it faces (its empty side). |
| 7–8 | Otherwise it's a normal BSP descent with splitting. |

The editor draws these, and the export lists them per leaf, so a runtime renders only the
surfaces of visible leaves.

---

## 8. Portals

File: `src/d3/core/portals/portals.ts`

```text
 1  byTag = map tag → list of (leaf, face) for every empty leaf face
 2  for each tag t (except BOUNDS_TAG):
 3      for (A, fa) in byTag[t] where A is in front of plane t:
 4          for (B, fb) in byTag[t] where B is behind plane t:
 5              w = intersectCoplanarWindings(fa, fb)
 6              if w is non-empty:
 7                  addPortal(from = A, to = B, winding = w oriented towards B)
 8                  addPortal(from = B, to = A, winding = reverse(w))   // twin
```

| Line | Explanation |
|---|---|
| 1 | Every leaf face remembers which BSP plane created it (§5 line 11). |
| 2 | Bounding-box faces lead to the void, not to another leaf. |
| 3–4 | Two leaves can only touch along a plane if they are on opposite sides of it *and* both have a face on it. Matching tags makes this exact; no epsilon comparison of planes is needed. |
| 5 | The opening is the overlap of the two faces: clip `fa` by the inward edge planes of `fb`. This also handles T-junctions, where one large face borders several small ones. |
| 7–8 | Each opening becomes two directed portals. A portal's normal always points into the leaf it leads `to`; flow (§11) relies on this. |

---

## 9. Leaks

File: `src/shared/core/portals/leaks.ts`

```text
1  seeds = empty leaves with any face tagged BOUNDS_TAG
2  leaked = flood fill from seeds through portals
3  report { seeds, leaked }
```

| Line | Explanation |
|---|---|
| 1 | Empty space touching the bounding box means the level isn't closed: there's a hole to the outside. |
| 2 | Everything connected to such a leaf is "outside" too. |
| 3 | Reported for the editor to highlight; compilation continues. CSG levels never leak; meshes can. |

---

## 10. Base vis

File: `src/shared/core/vis/baseVis.ts` (Golodetz, listings 4–5)

```text
1  for each portal i:
2      cand = { j | some vertex of j is in front of plane(i)
3                  and some vertex of i is behind plane(j) }
4      mightSee[i] = flood fill from leaf i.to through portals in cand
```

| Line | Explanation |
|---|---|
| 2 | A portal fully behind `i` can't be reached by looking through `i`. |
| 3 | And `i` must be behind `j`, or the ray would go through `j` backwards. |
| 4 | Of the portals passing both tests, keep only those actually reachable through the graph. This is a cheap upper bound (`mightSee`) that §11 shrinks. |

---

## 11. Portal flow

File: `src/shared/core/vis/portalFlow.ts` (Teller; Quake `vis`)

```text
 1  order = portals sorted by |mightSee| ascending
 2  for S in order:
 3      portalVis[S] = {}
 4      recurse(S.to, source = S.winding, pass = S.winding, might = mightSee[S])
 5      mark S done
 6
 7  function recurse(leaf, source, pass, might):
 8      for each portal G leaving leaf:
 9          if G not in might: continue
10          might2 = might ∩ (G done ? portalVis[G] : mightSee[G])
11          if G already in portalVis[S] and might2 adds nothing: continue
12          src = clipWinding(source, keep back of plane(G))
13          gen = clipWinding(G.winding, keep front of plane(S))
14          if pass ≠ S.winding:
15              gen = clipToSeparators(src, pass, target = gen)
16              src = clipToSeparators(gen, pass, target = src)
17          if src or gen is empty: continue
18          portalVis[S] += G
19          recurse(G.to, src, gen, might2)
20      if steps > maxSteps: portalVis[S] = mightSee[S]   // safety fallback
```

| Line | Explanation |
|---|---|
| 1 | Doing portals with small candidate sets first means their exact results are ready to prune larger searches (line 10). |
| 4 | Depth-first walk starting from the leaf behind S. `source` is the part of S that can still send light; `pass` is the last portal crossed. |
| 8–9 | Try each exit portal from the current leaf, but only if base vis allows it. |
| 10 | Narrow the candidate set: a portal reached through G can only be something G itself sees. |
| 11 | Pruning: already known and nothing new to discover, so skip. |
| 12 | Only the part of the source behind G can look through G. |
| 13 | Only the part of G in front of S can be seen from S. |
| 14–16 | The core of the algorithm. Light from `source` passing through `pass` fills a volume (the antipenumbra). Clip G to that volume, then clip the source to the volume seen back from G (§12). |
| 17 | If either vanished, no line of sight runs from S through the chain to G. |
| 18 | G is visible from S. |
| 19 | Continue past G with the shrunken windings. Shrinking stays **conservative**: any real sight line crosses every clipped winding. |
| 20 | `maxSteps` guards against combinatorial blow-up; base vis is always a safe answer. |

---

## 12. Separators (antipenumbra)

File: `src/d3/core/vis/antipenumbra.ts` (Golodetz listing 2; Quake `ClipToSeperators`)

```text
 1  function clipToSeparators(A, B, target):
 2      for (edgePoly, vertPoly) in [(A, B), (B, A)]:
 3          for each edge (e0, e1) of edgePoly:
 4              for each vertex v of vertPoly:
 5                  P = plane through e0, e1, v
 6                  if P is degenerate: continue
 7                  if edgePoly is not strictly on one side of P: continue
 8                  if vertPoly is not entirely on the other side (touching ok): continue
 9                  orient P so pass portal B is in front
10                  target = clipWinding(target, keep front of P)
11                  if target is empty: return empty
12      return target
```

| Line | Explanation |
|---|---|
| 1 | `A` is the light source winding, `B` the pass portal, `target` the winding to restrict. |
| 2 | Separators are built in both directions: edges of A with vertices of B, and edges of B with vertices of A. |
| 5 | Each candidate plane passes through one edge of one polygon and one vertex of the other. |
| 6 | Collinear points give no plane. |
| 7–8 | A **separating plane** has the two polygons on opposite sides. These planes bound the region light can reach after passing through both. |
| 9 | Orientation is chosen so the visible region is in front. |
| 10–11 | Clip right away and stop as soon as the target disappears. This is much cheaper than building the full plane list first. It is the compiler's hot loop, written with plain arithmetic and no allocation. |

In 2D the same idea is just lines through endpoint pairs; this file is where the 3D kernel
differs most.

---

## 13. Leaf PVS

File: `src/shared/core/vis/leafPvs.ts`

```text
1  for each leaf L:
2      pvs[L] = {L}
3      for each portal p leaving L:
4          pvs[L] += p.to
5          for each q in portalVis[p]:
6              pvs[L] += q.to
7  if symmetry == "intersect": pvs[a][b] = pvs[a][b] AND pvs[b][a]
8  if symmetry == "union":     pvs[a][b] = pvs[a][b] OR  pvs[b][a]
```

| Line | Explanation |
|---|---|
| 2 | A leaf always sees itself. |
| 3–4 | It always sees its direct neighbours (you can look straight through the opening). |
| 5–6 | Anything visible through one of its portals leads into a visible leaf. |
| 7 | Optional: keep a pair only if both directions agree (tighter, normally still safe). |
| 8 | Optional: add the pair if either direction says so (looser, extra safe). The default is `"none"`. |

Solid leaves get an empty row.

---

## 14. Shared rows

File: `src/shared/core/vis/pvsTable.ts`

```text
1  rows = [], leafRow = [], index = map rowBits → rowIndex
2  for each leaf L:
3      k = index[pvs[L]] ?? (rows.push(pvs[L]) - 1, remember)
4      leafRow[L] = k
```

| Line | Explanation |
|---|---|
| 1–3 | Many rows are identical: every solid leaf has the empty row, and neighbouring cells often see the same set. Each distinct row is stored once. |
| 4 | Each leaf keeps an index into the table. Decoding gives back the original PVS bit for bit; this is indirection only, not lossy compression. |

---

## 15. Export and runtime use

Files: `src/d3/core/export/pvsExport.ts`, `src/d3/core/bsp/query.ts`,
`src/shared/core/export/pvsRows.ts`

```text
 1  export (format v2):
 2      nodes:  plane, front ref, back ref
 3      leaves: contents, region, surfaces, rowIndex
 4      rows:   distinct PVS bitsets
 5
 6  runtime, each frame:
 7      ref = root
 8      while ref >= 0:
 9          ref = dot(n, eye) - d > 0 ? node[ref].front : node[ref].back
10      leaf = ~ref
11      row  = decodePvsRow(rows[leafRow[leaf]])
12      for each leaf k with row[k] set: draw surfaces[k]
```

| Line | Explanation |
|---|---|
| 2–4 | All a game engine needs: the tree to locate the camera, the surfaces to draw, and the visibility table. |
| 7–10 | Point location: one plane test per level of the tree. A negative ref is a leaf. |
| 11 | Look up the camera leaf's shared row. |
| 12 | Draw only what can possibly be seen; everything else is culled for free. |

---

## 16. How correctness is checked

| Test | What it ensures |
|---|---|
| `tests/d3/vis.test.ts` | **Conservativeness.** Random point pairs in random leaves of sample and randomly generated levels: if the segment between them crosses no wall, the PVS *must* contain the target leaf. Never weaken this test. |
| `tests/d3/csg-bsp.test.ts` | CSG output is watertight (Σ area·n = 0) and the BSP is consistent. |
| `tests/shared` | Both geometry kernels obey the same `Geometry<D>` contract. |
| Editor "True line of sight" layer | The same check, live: rays from the probe; a red dot would be a missed leaf. |

### Shared vs. 3D-specific code

| Shared (`src/shared/core`) | 3D-only (`src/d3/core`) |
|---|---|
| BSP build, refinement, surfaces (§5–7) | Brushes (§2), CSG (§3), OBJ import (§4) |
| Leaks, base vis, flow recursion (§9–11) | Portal discovery (§8) |
| Leaf PVS, shared rows (§13–14) | Separators / antipenumbra (§12), export layout (§15) |
