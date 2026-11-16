/**
 * Worker side of the flow protocol: holds one {@link createFlowSession} per
 * run and answers `flow` requests with its results. Each dimension's flow
 * worker entry is one call to this with its geometry.
 */

import { type Dim, type Geometry, type PortalGraph, createFlowSession } from "../../core";
import { type FlowRequest, type FlowResponse, toBitSet } from "./flowProtocol";

/** Installs the message handler on the worker global scope. */
export function serveFlow<D extends Dim>(geometry: Geometry<D>): void {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent<FlowRequest>) => void) | null;
    postMessage(message: FlowResponse, transfer?: Transferable[]): void;
  };
  let session: ReturnType<typeof createFlowSession<D>> | null = null;
  scope.onmessage = (e) => {
    const req = e.data;
    try {
      if (req.type === "begin") {
        session = createFlowSession(geometry, req.graph as unknown as PortalGraph<D>, req.mightSee.map(toBitSet), req.clipSource, req.rank);
        scope.postMessage({ id: req.id, results: [] });
        return;
      }
      if (!session) throw new Error("flow before begin");
      const known = req.known.map((r) => ({ id: r.id, vis: toBitSet(r.vis) }));
      const results = session.flow(known, req.sources, req.budget);
      // Copies, not transfers: the session keeps the rows for pruning later chunks.
      scope.postMessage({ id: req.id, results });
    } catch (err) {
      scope.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
