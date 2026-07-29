// Marketplace identity and URL construction.
//
// A marketplace is a GitHub repository with an addons/ directory. Only GitHub is
// accepted, which is what bounds the userscript's @connect list: no marketplace
// URL can aim GM_xmlhttpRequest at another host.

const RAW_BASE = 'https://raw.githubusercontent.com';
const API_BASE = 'https://api.github.com';

const NAME_RE = /^[A-Za-z0-9._-]+$/;
const REF_RE = /^[A-Za-z0-9._/-]+$/;
const GIT_SUFFIX_RE = /\.git$/;
const SCP_URL_RE = /^git@github\.com:([^/]+)\/(.+)$/;

/** Where `tree` or `blob` sits in /owner/repo/tree/<ref>, and where the ref starts. */
const REF_KIND_SEGMENT = 2;
const REF_FIRST_SEGMENT = 3;

interface ParsedUrl {
  owner: string;
  repo: string;
  ref: string;
}

type ParseResult = { ok: true; value: ParsedUrl } | { ok: false; error: string };

/** Pull owner, repo, and any pinned ref out of a github.com or scp-style URL. */
function parseGitHubUrl(raw: string): ParseResult {
  const scp = SCP_URL_RE.exec(raw);
  if (scp) {
    return { ok: true, value: { owner: scp[1] as string, repo: scp[2] as string, ref: 'HEAD' } };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    return { ok: false, error: 'marketplaces must be GitHub repositories' };
  }

  const seg = url.pathname.split('/').filter((part) => part.length > 0);
  if (seg.length < REF_KIND_SEGMENT) {
    return { ok: false, error: 'URL is missing owner/repo' };
  }

  // /owner/repo/tree/<ref>/... and /owner/repo/blob/<ref>/... both pin a ref,
  // which may itself contain slashes, e.g. release/2026-07.
  let ref = 'HEAD';
  const kind = seg[REF_KIND_SEGMENT];
  if (seg.length > REF_FIRST_SEGMENT && (kind === 'tree' || kind === 'blob')) {
    ref = seg.slice(REF_FIRST_SEGMENT).join('/');
  }

  return { ok: true, value: { owner: seg[0] as string, repo: seg[1] as string, ref } };
}

/** Split `owner/repo` shorthand, which carries no ref. */
function parseShorthand(raw: string): ParseResult {
  const parts = raw.split('/').filter((part) => part.length > 0);
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || repo === undefined) {
    return { ok: false, error: 'expected owner/repo or a github.com URL' };
  }
  return { ok: true, value: { owner, repo, ref: 'HEAD' } };
}

/** Reserved: normalizeMarketplaceUrl never produces this id. */
export const OFFICIAL_ID = 'official';

export interface MarketplaceRef {
  id: string;
  owner: string;
  repo: string;
  /** Branch, tag, or commit. 'HEAD' resolves to the repository default branch. */
  ref: string;
  name: string;
}

/**
 * The built-in marketplace: never persisted, merged in at position 0 on every
 * registry read, and rejected by canRemoveMarketplace.
 *
 * "Official" means official to this loader. The game project is a separate
 * repository under a different owner and does not endorse it.
 */
export const OFFICIAL: MarketplaceRef = Object.freeze({
  id: OFFICIAL_ID,
  owner: 'MarshalX',
  repo: 'world-of-claudecraft-addons',
  ref: 'HEAD',
  name: 'Official Marketplace',
});

export type NormalizeResult = { ok: true; ref: MarketplaceRef } | { ok: false; error: string };

export function marketplaceId(owner: string, repo: string): string {
  return `gh:${owner}/${repo}`;
}

export function indexUrl(market: MarketplaceRef): string {
  return `${RAW_BASE}/${market.owner}/${market.repo}/${market.ref}/marketplace.json`;
}

export function fileUrl(market: MarketplaceRef, path: string): string {
  return `${RAW_BASE}/${market.owner}/${market.repo}/${market.ref}/${path}`;
}

/** Fallback enumeration, used only when a repository has no marketplace.json. */
export function contentsApiUrl(market: MarketplaceRef): string {
  const ref = encodeURIComponent(market.ref);
  return `${API_BASE}/repos/${market.owner}/${market.repo}/contents/addons?ref=${ref}`;
}

/** Storage namespace, registry key, and keybind scope. Marketplaces may share an addon id. */
export function fqid(marketplace: string, addonId: string): string {
  return `${marketplace}/${addonId}`;
}

export function splitFqid(value: string): { marketplace: string; addonId: string } | null {
  const at = value.lastIndexOf('/');
  if (at <= 0 || at === value.length - 1) {
    return null;
  }
  return { marketplace: value.slice(0, at), addonId: value.slice(at + 1) };
}

/**
 * Reduce anything a user might paste to a MarketplaceRef.
 *
 * Accepts `owner/repo`, a github.com URL, a `.git` clone URL, and a tree or blob
 * URL carrying a branch or tag. Every non-GitHub host is rejected.
 */
export function normalizeMarketplaceUrl(input: string): NormalizeResult {
  const raw = input.trim();
  if (raw.length === 0) {
    return { ok: false, error: 'enter a GitHub repository' };
  }

  const isUrl = raw.includes('://') || raw.startsWith('git@');
  let parsed: ParseResult;
  if (isUrl) {
    parsed = parseGitHubUrl(raw);
  } else {
    parsed = parseShorthand(raw);
  }
  if (!parsed.ok) {
    return parsed;
  }

  const { owner, ref } = parsed.value;
  const repo = parsed.value.repo.replace(GIT_SUFFIX_RE, '');

  if (!(NAME_RE.test(owner) && NAME_RE.test(repo))) {
    return { ok: false, error: 'invalid owner or repository name' };
  }
  if (!REF_RE.test(ref)) {
    return { ok: false, error: 'invalid branch, tag, or commit' };
  }

  const id = marketplaceId(owner, repo);
  if (id === OFFICIAL_ID) {
    return { ok: false, error: 'that id is reserved' };
  }

  return { ok: true, ref: { id, owner, repo, ref, name: `${owner}/${repo}` } };
}
