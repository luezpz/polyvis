# AGENTS.md

Guidance for AI coding agents (and humans). Read this first, then `PLAN.md` / `PROGRESS.md`.

## What this is

A PVS (potentially visible set) baker, CSG → solid-leaf BSP → portals → portal flow → leaf
PVS → export, in **two dimensions sharing one compiler core**:

- **2D** (`src/d2`): Canvas2D editor. The **testbed**: prototype ideas here first.
- **3D** (`src/d3`): WebGL2 editor, OBJ import, compile worker. The product.

Workflow: try an idea in 2D; if it works, port it to 3D. Whenever possible, put it in
`src/shared` so it works in both at once (see "Where does new code go?").

## Commands

```sh
npm run dev         # Vite dev server: / (landing), /2d.html, /3d.html
npm test            # all vitest suites (must pass before you finish)
npm run test:2d     # tests/d2 + tests/shared
npm run test:3d     # tests/d3 + tests/shared (slow: ~15 s)
npm run typecheck   # tsc --noEmit (must pass)
npm run build       # typecheck + bundle all three pages into dist/
```

## Architecture map

```
src/shared/core/      dimension-agnostic compiler, generic over D extends Dim
  geometry.ts         THE SEAM: Geometry<D> interface every stage is written against
  math/               tolerances, Side
  wall.ts             Wall<D> (BSP input)
  bsp/                build, refine (corner/size splits), query, leaf surfaces, types
  portals/            Portal<D>/PortalGraph<D> types, components, leak detection
  vis/                BitSet, base vis, portal flow, leaf PVS, shared PVS rows
  pipeline.ts         createCompiler(config) → { compileLevel, compileWalls }
  export/pvsRows.ts   decodePvsRow
src/d2/core/          2D kernel: Vec2, Line2, Segment, ConvexPolygon; CSG; portal discovery;
                      2D antipenumbra; geometry.ts (geometry2); pipeline binding; export
src/d3/core/          3D kernel: Vec3, Plane3, Winding, ConvexPolyhedron, brushes as planes;
                      CSG + mesh walls; OBJ import; 3D antipenumbra; geometry.ts (geometry3)
src/shared/app/        browser code shared by both editors (never imported by core)
  editor/             history, BaseViewState (layers, probe, snapping)
  compile/            CompileClient<D, L>, worker protocol + hydrateResult, serveCompiler
  ui/                 dom helpers, panel widgets, compile panel sections, base styles.css
  render/palette.ts   brush-kind colours, leaf hue
src/d2/app, src/d3/app   editors (separate on purpose; see PLAN.md for sharing candidates)
tests/shared          Geometry contract tests run against both kernels
tests/d2, tests/d3    per-dimension suites (ported verbatim from polyvis2d / polyvis3d)
docs/ALGORITHMS.md    index → ALGORITHMS-2D.md, ALGORITHMS-3D.md
2d.html, 3d.html, index.html   Vite multi-page entry points
```

Each dimension's `core/index.ts` re-exports a **monomorphic** API (`compileLevel(level)`,
`buildBsp(walls)`, `Wall`, `BspTree`, ...) that binds the shared generics to its geometry.
Apps and tests only import their own dimension's barrel; they never pass a `Geometry` around.

## Where does new code go?

| The change is about...                                  | Put it in                    |
|---------------------------------------------------------|------------------------------|
| an algorithm over planes/facets/cells (BSP, vis, PVS)   | `src/shared/core`, generic   |
| a new primitive operation that algorithm needs          | add it to `Geometry<D>`, implement in **both** `d2/core/geometry.ts` and `d3/core/geometry.ts`, cover it in `tests/shared` |
| CSG, portal discovery, import formats, export layout    | `src/d{2,3}/core`            |
| UI / rendering                                          | `src/d{2,3}/app`; parts both editors use in `src/shared/app` |

Every feature landing in one dimension gets a PROGRESS.md line saying whether the other
dimension has it; parity gaps are tracked in PLAN.md.

## Architecture rules

- `src/*/core/` is a **pure library**: no DOM, no globals, no app imports. Runs in Node and
  workers. Dependency direction: `d2|d3/app → d2|d3/core → shared/core`, and `d2|d3/app → shared/app → shared/core`. Never the reverse;
  `shared` never imports `d2`/`d3`.
- `Geometry` functions must not use `this` (hot loops destructure them).
- Compile results (both dimensions) cross the worker boundary by structured clone; class instances (`BitSet`) are
  restored in `shared/app/compile/protocol.ts`; update it if you add any.
- Data between stages is immutable (`readonly`). Levels are immutable values.
- Small single-purpose modules; every exported function/type has a doc comment stating
  conventions (orientation, units, null cases).

## Geometric conventions (do not break)

- A plane (2D: line) is `{ n, d }` with unit `n`; front = `n·p − d > 0`.
- Field names are the same in both dimensions: walls and portals have `winding` (2D: a
  `Segment`, 3D: a `Winding`) and `plane` (2D: `Line2`, 3D: `Plane3`); leaves/nodes have `region`.
- Walls: empty space in **front** (2D: on the left of a→b; 3D: CCW seen from the front).
- Cells: 2D CCW polygons with tagged edges; 3D polyhedra with outward, tagged faces.
  Tags are BSP plane indices (`BOUNDS_TAG` for the box).
- Portal `p`: plane normal points into `p.to`.
- BSP child refs: `>= 0` node, `< 0` leaf `~ref`.
- 3D world is **Z-up**.
- Use the tolerances in `shared/core/math/tolerance.ts`; don't sprinkle new epsilons.
- Clipping discards parts lying exactly on the clip plane.

## Testing expectations

- The PVS must be **conservative**: never miss a visible leaf. The randomized line-of-sight
  tests in `tests/d*/vis.test.ts` enforce this. Never weaken them to make a change pass.
- CSG output must stay watertight (`tests/d*/csg-bsp.test.ts`).
- A change to `src/shared` must pass **both** suites.
- Add a test for every bug fix and every new stage/option, in each dimension it affects.
- UI changes: run the app and check it in a browser (`window.polyvis` exposes the app).

## Style

- TypeScript strict; no `any`. Plain objects + functions in core; classes only for state.
- Zero runtime dependencies (the WebGL layer is hand-written on purpose).
- Hot loops (`vis/portalFlow.ts`, `d3/core/vis/antipenumbra.ts`) use plain arithmetic.
- Comments explain *why* and the algorithm, citing Golodetz / Teller / Quake where relevant.

## Gotchas

- 2D and 3D default `minCellSize` differ (0.5 vs 1): defaults live in each `bsp/bsp.ts`.
- Autosave keys differ per editor (`polyvis.level.v1`, `polyvis3d.level.v1`); same origin now.
- `git` history of the original repos is not carried over (see PROGRESS.md).
