# Algorithms

The stages are identical in 2D and 3D; only the geometry differs. Since the merge, every stage
from the BSP onwards is a single implementation in `src/shared/core`, written against the
`Geometry<D>` interface (`src/shared/core/geometry.ts`); CSG, portal discovery and the
antipenumbra (separator construction) remain per dimension.

- [ALGORITHMS-2D.md](ALGORITHMS-2D.md): every stage explained in 2D (the simplest setting).
- [ALGORITHMS-3D.md](ALGORITHMS-3D.md): what changes in 3D, plus OBJ import and PVS row sharing.

File paths in those documents predate the merge: `src/core/X` means `src/d2/core/X` or
`src/d3/core/X`, or `src/shared/core/X` for bsp/build, bsp/refine, bsp/surfaces,
portals/leaks and vis/{baseVis,portalFlow,leafPvs,bitset,pvsTable}.
