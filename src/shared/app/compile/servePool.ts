/**
 * Worker side of the pool protocols: one {@link createFlowSession}, one
 * {@link createBspSession}, one passage and one base vis row builder per run, answering flow, BSP,
 * passage and base vis requests. Each
 * dimension's pool worker entry is one call to this with its geometry.
 */

import { type Dim, type Geometry, type PortalGraph, type RemoteTask, createBspSession, createFlowSession, createPassageSession, createBaseVisSession } from "../../core";
import type { BspRequest, BspResponse } from "./bspProtocol";
import { type FlowRequest, type FlowResponse, toBitSet } from "./flowProtocol";
import type { PassageRequest, PassageResponse } from "./passageProtocol";
import type { BaseVisRequest, BaseVisResponse } from "./baseVisProtocol";

type Request = FlowRequest | BspRequest | PassageRequest | BaseVisRequest;
type Response = FlowResponse | BspResponse | PassageResponse | BaseVisResponse;

/** Installs the message handler on the worker global scope. */
export function servePool<D extends Dim>(geometry: Geometry<D>): void {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent<Request>) => void) | null;
    postMessage(message: Response, transfer?: Transferable[]): void;
  };
  let flow: ReturnType<typeof createFlowSession<D>> | null = null;
  let bsp: ReturnType<typeof createBspSession<D>> | null = null;
  let passageRows: ((p0: number, p1: number) => Uint32Array) | null = null;
  let baseVisRows: ((p0: number, p1: number) => Uint32Array) | null = null;

  const answer = (req: Request): Response => {
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
      case "passage-begin":
        passageRows = createPassageSession(geometry, req.graph, req.mightSee);
        return { id: req.id, ok: true };
      case "passage-rows":
        if (!passageRows) throw new Error("passage rows before begin");
        return { id: req.id, words: passageRows(req.p0, req.p1) };
      case "basevis-begin":
        baseVisRows = createBaseVisSession(geometry, req.graph);
        return { id: req.id, ok: true };
      case "basevis-rows":
        if (!baseVisRows) throw new Error("base vis rows before begin");
        return { id: req.id, words: baseVisRows(req.p0, req.p1) };
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
      const res = answer(e.data);
      // Passage and base vis rows are fresh arrays the worker never reads again: transfer instead of copying.
      scope.postMessage(res, "words" in res ? [res.words.buffer] : []);
    } catch (err) {
      scope.postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
