# polyvis

Bake **PVS (potentially visible set)** occlusion-culling data for levels made of convex
brushes (and, in 3D, imported meshes), using the classic Quake/Teller pipeline:

```
brushes ──CSG──▶ walls ──BSP──▶ convex cells ──▶ portals ──base vis──▶ might-see
                   │                               │
 raw geometry ─────┘                               └──portal flow (antipenumbra clipping)──▶ portal vis ──▶ leaf PVS ──▶ export
```

The project has **two editors over one compiler core**:

- **2D** (Canvas2D): the simplest setting, used as a testbed for new ideas.
- **3D** (WebGL2): convex polyhedral brushes, OBJ import.

Both editors compile in a Web Worker, which runs the BSP build and portal flow on a pool of
nested workers on large levels (same results as single-threaded).

Everything from the BSP onwards (BSP build and refinement, leaf surfaces, leaks, base vis,
portal flow, leaf PVS, PVS row sharing) is **one implementation** in `src/shared/core`,
written against a small geometry interface that each dimension implements. An idea
prototyped there works in both dimensions at once. See [docs/ALGORITHMS.md](docs/ALGORITHMS.md).

## Quick start

```sh
npm install
npm run dev        # http://localhost:5173 → pick 2D or 3D
npm test           # unit tests + randomized line-of-sight ground-truth checks (both dimensions)
npm run build      # typecheck + production bundle in dist/
```

Requires Node 20.19+ or 22.12+ (Vite 8) (and WebGL2 for the 3D editor). Zero runtime dependencies.

## Using the editors

### 2D editor (`/2d.html`)

| Tool | Key | What it does |
|---|---|---|
| Select | `V` | Click to select (smallest brush under cursor; click again to cycle to larger ones), drag to move, drag vertex dots to reshape, drag edge squares to push/pull an edge, `Del` delete, `Ctrl+D` duplicate |
| Box | `B` | Drag a rectangle brush |
| Polygon | `P` | Click points; `Enter` / double-click / click the first point to finish. The brush is the convex hull of the points |
| Inspect | `I` | Hover to probe the PVS of the leaf under the cursor; click to pin; hover a portal to see its portal vis |

- `K` toggles between **room** brushes (carve empty space) and **solid** brushes (occluders such as
  pillars put back inside rooms). With a brush selected in Select mode, `K` toggles that brush.
- Wheel zooms; middle/right drag or `Space`+drag pans; `F` fits the view; `Ctrl+Z` / `Ctrl+Y` undo/redo.
- The level recompiles in a Web Worker on every edit and is autosaved to `localStorage`.
- The level menu lists the basic samples plus demo groups: **Heavy** (for timing), **Worst
  case** (shapes that blow up one stage) and **Edge case** (degenerate contacts, numerics).
  The same menu exists in the 3D editor.
- **Save…/Open…** read and write the level as JSON. **Export PVS** writes the compiled
  BSP + portals + PVS as JSON or as a line-based text file.

#### Reading the view

- Coloured cells: empty BSP leaves. White lines: walls (ticks point into empty space).
  Yellow: portals. Orange dashed (optional): BSP splitters. "Surfaces (PVS coloured)" draws
  each leaf's wall pieces coloured by the probe's PVS; "Hide culled surfaces" hides the rest.
- Inspect: the probed leaf is bright green, its PVS light green, everything it cannot see is
  darkened. The white fan is the **exact** visibility from the cursor. The PVS must always cover
  the fan (it is conservative: it can be larger, never smaller).
- Hovering a portal: cyan = portals it sees after the portal flow; purple dashed = portals the
  cheap base vis allowed but the flow rejected.
- Red dashed cells: leak (an empty leaf touches the level bounds — only possible with raw,
  non-CSG input).

### 3D editor (`/3d.html`)

The world is **Z-up**, 1 unit ≈ 1 m. Brushes are drawn on a horizontal **work plane**.

| Tool | Key | What it does |
|---|---|---|
| Select | `V` | Click to select (smallest brush along the ray; click again to cycle to larger ones). Drag to move horizontally, `Shift`+drag vertically. Drag a **face handle** (square at a face centre) to push/pull that face. `Del` delete, `Ctrl+D` duplicate |
| Box | `B` | Drag a rectangle on the work plane; the box gets the panel's "new brush height" |
| Polygon | `P` | Click points on the work plane; `Enter` / double-click / first point to finish. Convex hull, extruded |
| Inspect | `I` | Hover a surface to probe the PVS there; click to pin; look through a portal to see its portal vis |

- Navigation: **right drag** orbit, **middle drag** or `Shift`+right drag pan, **wheel** zoom,
  **WASD** fly, **Q/E** down/up (`Shift` = faster), `F` fit view. `Alt`/`Space`+left drag also orbits.
- `[` / `]` (or PageDown/PageUp) move the work plane by one grid step; "Work plane → floor" in
  the selection panel snaps it to the selected brush.
- `K` toggles **room** brushes (carve empty space) and **solid** brushes (put matter back:
  pillars, slabs between storeys, ramps). With a brush selected in Select mode, `K` toggles it.
- `Ctrl+Z` / `Ctrl+Y` undo/redo. The level recompiles in a Web Worker on every edit and is
  autosaved to `localStorage`. **Save…/Open…** use JSON (`polyvis-level-3d`).
- **Probe from camera position**: the PVS of the camera's own leaf. Zoom in close, fly through
  the level with WASD and watch what gets culled.
- **Import OBJ…** (e.g. from Blender) adds a raw mesh: no CSG, faces must point *into* the
  rooms ("Flip normals" if your rooms were modelled with outward normals; "Y-up" for
  Blender's default OBJ axes). Coplanar triangles are merged back into convex polygons. Leaks
  are reported, not fatal.

#### Reading the view

- Shaded surfaces are the walls, split per BSP leaf (back faces are culled, so you can look
  into rooms from outside). Blue/red outlines: room/solid brushes. Yellow: portals.
- Inspect: the probed leaf is bright green, surfaces of leaves in its PVS keep their colour,
  everything it cannot see is dark (or hidden with "Hide culled surfaces").
- **True line of sight**: rays from the probe to the first wall they hit. Green dot = the leaf
  just in front of the hit is in the PVS. A **red** dot would mean the PVS missed something
  visible, which is a bug (the PVS must be conservative).
- Looking through a portal: cyan = portals it sees after the flow; purple = allowed by the
  cheap base vis but rejected by the flow.
- Red cell outlines: leak (an empty leaf touches the level bounds; only possible with raw
  mesh input).

## Export format (3D)

- `level.pvs.json`: `{ format: "polyvis-pvs-3d", version: 2, planes, nodes, root, walls, leaves, portals, pvs }`
- `level.pvs.txt`: the same data line by line, parseable with `sscanf`.

Runtime use: walk the BSP with the camera position (front if `n·p − d ≥ 0`; negative child
references are leaves, `leaf = -ref - 1`), then draw the walls listed by every leaf whose bit
is set in the camera leaf's PVS row, `pvs.rows[leaf.pvs]`. **Identical rows are stored once**:
each leaf holds an index into a table of distinct rows (all solid leaves share the empty row),
and leaves stay the convex BSP cells, so dynamic objects can still be tested against them.
Rows are hex, LSB-first per byte (bit `j` → byte `j >> 3`,
bit `j & 7`), like Quake. `src/d3/core/export/pvsExport.ts` documents both encodings.

The 2D export (`polyvis-pvs-2d`, version 2) uses the same layout (shared rows, `walls`,
per-leaf wall lists), with leaf polygons instead of bounds and walls as `a`/`b` segments;
see `src/d2/core/export/pvsExport.ts`.

## Project layout

```
src/
  shared/core/   dimension-agnostic compiler (generic over the geometry; see geometry.ts)
  shared/app/    browser code both editors use (history, compile worker client, nested worker
                 pool for parallel BSP / flow, UI widgets)
  d2/core/       2D kernel (Vec2, lines, segments, polygons), CSG, portals, export,
                 level/ (samples, demos, builder helpers)
  d2/app/        Canvas2D editor + compile worker
  d3/core/       3D kernel (Vec3, planes, windings, polyhedra, brushes), CSG, OBJ import, export,
                 level/ (samples, demos, builder helpers)
  d3/app/        WebGL2 editor + compile worker
tests/{shared,d2,d3}/   vitest suites
docs/            algorithm notes
AGENTS.md        contributor/agent guide · NOTES.md decisions and open TODOs
```

## References

- Stuart Golodetz, *If You Can't See Me, I Can't See You*, Overload 90 (2009): portal flow and antipenumbra clipping.
- Seth Teller, *Visibility Computations in Densely Occluded Polyhedral Environments*, PhD thesis (1992).
- Pekka Väänänen, [vis.py](https://github.com/pekkavaa/vis.py): a readable Python port of Quake's vis.
- id Software, Quake `qbsp` / `vis` sources.
