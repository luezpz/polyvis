/** Web Worker running parts of the 2D portal flow and BSP build, spawned by the compile worker (see shared/app/compile/workerPool.ts). */

import { geometry2 } from "../../core/geometry";
import { servePool } from "../../../shared/app/compile/servePool";

servePool(geometry2);
