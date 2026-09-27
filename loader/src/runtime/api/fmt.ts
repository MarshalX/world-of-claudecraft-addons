// `woc.fmt`, one frozen object shared by every addon: nothing here is per-addon.

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
