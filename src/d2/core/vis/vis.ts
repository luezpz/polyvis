/**
 * The visibility stages bound to 2D: the algorithms live in `shared/core/vis`
 * and run on {@link geometry2} (whose antipenumbra is `./antipenumbra.ts`).
 */

import * as shared from "../../../shared/core";
import type { BspTree } from "../bsp";
import { geometry2 } from "../geometry";
import type { PortalGraph } from "../portals";

export {
  type PortalFlowOptions, type PortalFlowResult, type PortalFlowStats, type PvsSymmetry, type PvsTable,
  BitSet, DEFAULT_PORTAL_FLOW_OPTIONS, buildPvsTable, pvsRowOf,
} from "../../../shared/core";

/** Base vis rules 1 + 2 for an ordered portal pair. */
export const portalMightSeePortal = (graph: PortalGraph, i: number, j: number): boolean => shared.portalMightSeePortal(geometry2, graph, i, j);

/** The "might see" set of every portal. `useSpheres`: bounding-sphere pre-test (same result, faster). */
export const computeBaseVis = (graph: PortalGraph, useSpheres = true): shared.BitSet[] => shared.computeBaseVis(geometry2, graph, useSpheres);

/** Phase 2a/2b: canSee rows of every (portal, next portal) pair, or null if too big. See `shared/core/vis/passages.ts`. */
export const computePassages = (graph: PortalGraph, mightSee: readonly shared.BitSet[]): shared.PassageTable | null => shared.computePassages(geometry2, graph, mightSee);

/** Phase 2a: mightSee tightened by a passage table (each row ⊆ its base row). */
export const passageMightSee = (graph: PortalGraph, table: shared.PassageTable): shared.BitSet[] => shared.passageMightSee(graph, table);

/** Portal flow: the portals each portal can really see through (conservative). */
export const computePortalFlow = (graph: PortalGraph, mightSee: readonly shared.BitSet[], options: Partial<shared.PortalFlowOptions> = {}): shared.PortalFlowResult =>
  shared.computePortalFlow(geometry2, graph, mightSee, options);

/** One PVS row per BSP leaf. */
export const computeLeafPvs = (tree: BspTree, graph: PortalGraph, portalVis: readonly shared.BitSet[], symmetry: shared.PvsSymmetry = "none"): shared.BitSet[] =>
  shared.computeLeafPvs(tree, graph, portalVis, symmetry);
