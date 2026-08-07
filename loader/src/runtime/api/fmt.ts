// `woc.fmt`, the formatting surface.
//
// One frozen object shared by every addon, unlike the rest of `woc`: these carry
// no addon context and no disposal bag, so there is nothing per-addon to build.

import type { DurationStyle } from '../../shared/fmt.ts';
import { compass, count, duration, titleCase } from '../../shared/fmt.ts';

interface FmtApi {
  duration: (seconds: number | null, style?: DurationStyle) => string;
  titleCase: (id: string) => string;
  count: (n: number, singular: string, plural?: string) => string;
  compass: (degrees: number | null) => string;
}

const FMT: FmtApi = Object.freeze({ duration, titleCase, count, compass });

function createFmtApi(): FmtApi {
  return FMT;
}

export type { FmtApi };
export { createFmtApi };
