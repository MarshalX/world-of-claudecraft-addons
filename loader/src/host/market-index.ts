// Reading one source's addon rows: its index, or the repository itself if it has none.

import { indexUrl, type MarketplaceRef } from '../shared/marketplace.ts';
import type { MarketplaceEntry, ValidationIssue } from '../shared/schema.ts';
import { validateIndex } from '../shared/schema.ts';
import { enumerateAddons } from './contents-fallback.ts';
import type { Fetcher } from './fetcher.ts';
import { isHttpStatus } from './fetcher.ts';

/** How many index issues to quote before the message stops being readable. */
const MAX_QUOTED_ISSUES = 3;

/** No marketplace.json, which is the one failure the fallback answers. */
const NOT_FOUND = 404;

type IndexFetcher = Pick<Fetcher, 'getJson'>;

/** One source's rows, and whether reading them needed the fallback. */
interface Rows {
  addons: MarketplaceEntry[];
  degraded: boolean;
}

/** A validation failure rendered as one line, since it lands in a pane, not a log. */
function indexIssues(issues: readonly ValidationIssue[]): string {
  const quoted = issues
    .slice(0, MAX_QUOTED_ISSUES)
    .map((issue) => `${issue.path || '(root)'}: ${issue.message}`)
    .join('; ');
  if (issues.length > MAX_QUOTED_ISSUES) {
    return `${quoted}; and ${issues.length - MAX_QUOTED_ISSUES} more`;
  }
  return quoted;
}

/**
 * Enumerate the repository. If its listing 404s too, the repository is invisible (private,
 * renamed, or absent), so the index's own 404 is rethrown rather than the contents API URL.
 */
async function enumerate(
  fetcher: IndexFetcher,
  ref: MarketplaceRef,
  indexFailure: unknown,
): Promise<MarketplaceEntry[]> {
  try {
    return await enumerateAddons(fetcher, ref);
  } catch (err) {
    if (isHttpStatus(err, NOT_FOUND)) {
      throw indexFailure;
    }
    throw err;
  }
}

/**
 * One source's addons: its index, or the repository itself if it has none.
 *
 * The fallback runs only on a 404. A 403 is the rate limit and would only be deepened, and an
 * index that is present but invalid is what to report.
 */
async function readRows(fetcher: IndexFetcher, ref: MarketplaceRef): Promise<Rows> {
  try {
    const { value } = await fetcher.getJson(indexUrl(ref));
    const parsed = validateIndex(value);
    if (!parsed.ok) {
      throw new Error(`the index is not valid: ${indexIssues(parsed.issues)}`);
    }
    return { addons: parsed.value.addons, degraded: false };
  } catch (err) {
    // The dev server always generates an index, so a 404 there has nothing to enumerate.
    if (!isHttpStatus(err, NOT_FOUND) || ref.source.kind !== 'github') {
      throw err;
    }
    return { addons: await enumerate(fetcher, ref, err), degraded: true };
  }
}

export type { IndexFetcher, Rows };
export { indexIssues, readRows };
