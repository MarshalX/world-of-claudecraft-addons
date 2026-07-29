// Reading one source's addon rows, by whichever route that source supports.
//
// Split from host/marketplace.ts, which owns the per-session cache and the
// MarketApi over it, because this is the part with a decision in it: an index if
// the source publishes one, the repository itself if it does not, and neither if
// what came back says something else went wrong.

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
 * Enumerate the repository, restoring the index's own failure if it is missing.
 *
 * A repository that answers 404 for its addons/ listing too is not a marketplace
 * with no index, it is a repository the loader cannot see: private, renamed, or
 * never there. Reporting the contents API's URL for that would point a player at
 * an endpoint they never asked for, so the message they get back is the one
 * about the index they were actually looking for. Anything else the fallback
 * raises is its own answer and is reported as such.
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
 * The fallback is reached only on a 404, which is what "this repository has not
 * wired the Action yet" looks like. Every other failure is rethrown: a 403 is
 * the unauthenticated rate limit, and answering it by issuing one request per
 * addon would spend what is left of the hour finding out there is none. An index
 * that is present but invalid is also not a fallback case, since the source did
 * publish one and what it published is the thing to report.
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
    // The dev server generates its index from the directory on every request,
    // so a 404 there means the server is not running rather than that it has no
    // index, and there is nothing on the other side to enumerate.
    if (!isHttpStatus(err, NOT_FOUND) || ref.source.kind !== 'github') {
      throw err;
    }
    return { addons: await enumerate(fetcher, ref, err), degraded: true };
  }
}

export type { IndexFetcher, Rows };
export { indexIssues, readRows };
