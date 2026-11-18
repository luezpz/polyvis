/**
 * Worker side of the pool protocols: one {@link createFlowSession} and one
 * {@link createBspSession} per run, answering flow and BSP requests. Each
 * dimension's pool worker entry is one call to this with its geometry.
 */

import { type Dim, type Geometry, type PortalGraph, type RemoteTask, createBspSession, createFlowSession } from "../../core";
import type { BspRequest, BspResponse } from "./bspProtocol";
import { type FlowRequest, type FlowResponse, toBitSet } from "./flowProtocol";

/** Installs the message handler on the worker global scope. */
export function servePool<D extends Dim>(geometry: Geometry<D>): void {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent<FlowRequest | BspRequest>) => void) | null;
    postMessage(message: FlowResponse | BspResponse): void;
  };
  let flow: ReturnType<typeof createFlowSession<D>> | null = null;
  let bsp: ReturnType<typeof createBspSession<D>> | null = null;

  const answer = (req: FlowRequest | BspRequest): FlowResponse | BspResponse => {
    switch (req.type) {
      case "begin":
        flow = createFlowSession(geometry, req.graph as unknown as PortalGraph<D>, req.mightSee.map(toBitSet), req.clipSource, req.rank, req.passages);
        return { id: req.id, results: [] };
      case "flow": {
        if (!flow) throw new Error("flow before begin");
        const known = req.known.map((r) => ({ id: r.id, vis: toBitSet(r.vis) }));
        // Copies, not transfers: the session keeps the rows for pruning later chunks.
        return { id: req.id, results: flow.flow(known, req.sources, req.budget) };
      }
      case "bsp-begin":
        bsp = createBspSession(geometry, req.walls, req.opts);
        return { id: req.id, ok: true };
      case "bsp-score":
        if (!bsp) throw new Error("bsp before begin");
        return { id: req.id, choice: bsp.score(req.source, req.candidates) };
      case "bsp-subtree":
        if (!bsp) throw new Error("bsp before begin");
        return { id: req.id, subtree: bsp.subtree(req.task as unknown as RemoteTask<D>) as never };
    }
  };

  scope.onmessage = (e) => {
    try {
      scope.postMessage(answer(e.data));
    } catch (err) {
      scope.postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
