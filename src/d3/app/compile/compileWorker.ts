/** Web Worker running the (DOM-free) 3D compiler, so the editor stays responsive while the portal flow runs. */

import { compileLevel } from "../../core";
import { serveCompiler } from "../../../shared/app/compile/serveCompiler";

serveCompiler(compileLevel);
