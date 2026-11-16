/** Web Worker running part of the 2D portal flow, spawned by the compile worker (see shared/app/compile/flowPool.ts). */

import { geometry2 } from "../../core/geometry";
import { serveFlow } from "../../../shared/app/compile/serveFlow";

serveFlow(geometry2);
