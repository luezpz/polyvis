# NOTES

Session memory. Architecture, commands and conventions live in `AGENTS.md`; this file holds
only decisions, gotchas and open items. The 2D/3D merge (former PLAN.md / PROGRESS.md) is done.

## Key decisions
- 2D stays brush-only: no raw-wall/mesh import UI (user decision, 2026-11-15).
  `compileWalls` still accepts raw walls programmatically.
- `makeWall` / CSG `EmptySpaceTest` are not unified across dimensions: 5-line functions over
  different primitives; sharing would need new `Geometry` ops for little gain.
- Intentional parity gaps: probe-from-camera and work plane / brush height are 3D-only;
  vertex drag is 2D-only (3D brushes are planes).

## Gotchas
- Git history of the source repos (`polyvis2d` cdac3e9, `polyvis3d` 2de2526) was not carried over.

## Open TODOs
- Browser smoke test never done by an agent: `/2d.html` worker compile, select tool
  (click-to-cycle, edge push/pull), surfaces layer; `/3d.html` panel after the shared-UI refactor.
- Open decision: merge the two editor shells (panel/app) further, or keep sharing helpers only.
