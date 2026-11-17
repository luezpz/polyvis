# Algorithms

The stages are identical in 2D and 3D; only the geometry differs. Since the merge, every stage
from the BSP onwards is a single implementation in `src/shared/core`, written against the
`Geometry<D>` interface (`src/shared/core/geometry.ts`); CSG, portal discovery and the
antipenumbra (separator construction) remain per dimension. The BSP build and portal flow also
have exact parallel variants (ALGORITHMS-2D §2 and §5).

- [ALGORITHMS-2D.md](ALGORITHMS-2D.md): every stage explained in 2D (the simplest setting).
- [ALGORITHMS-3D.md](ALGORITHMS-3D.md): what changes in 3D, plus brushes as planes and OBJ import.
- [PIPELINE-3D.md](PIPELINE-3D.md): the whole 3D pipeline as pseudocode, explained line by line.
