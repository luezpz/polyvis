/** Browser entry point. */

import "./styles.css";
import { App } from "./app";

const canvas = document.querySelector<HTMLCanvasElement>("#viewport");
const overlay = document.querySelector<HTMLCanvasElement>("#overlay");
const panel = document.querySelector<HTMLElement>("#panel");
const status = document.querySelector<HTMLElement>("#status");
if (!canvas || !overlay || !panel || !status) throw new Error("index.html is missing #viewport, #overlay, #panel or #status");

try {
  // Exposed for debugging from the devtools console.
  (window as unknown as { polyvis: App }).polyvis = new App(canvas, overlay, panel, status);
} catch (e) {
  status.textContent = `Failed to start: ${(e as Error).message}`;
  throw e;
}
