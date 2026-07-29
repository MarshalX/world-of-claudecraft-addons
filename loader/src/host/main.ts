// Userscript sandbox entry: owns GM storage, marketplace fetching, and the
// registry. Never touches the page's JS heap.

import { bootHost } from './boot.ts';

bootHost(globalThis);
