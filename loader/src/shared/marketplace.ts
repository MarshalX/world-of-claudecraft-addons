// Marketplace identity and URL construction. Only GitHub repositories are accepted, which is what
// bounds the userscript's @connect list. The local dev server is the one other source, and its
// origin is a build-time constant, never user input.

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

/** The base every file in a marketplace hangs off. */
function marketplaceBase(source: MarketplaceSource): string {
  if (source.kind === 'local') {
    return source.origin;
  }
  return `${RAW_BASE}/${source.owner}/${source.repo}/${source.ref}`;
}

/** Reserved: normalizeMarketplaceUrl never produces either of these ids. */
export const OFFICIAL_ID = 'official';
export const LOCAL_ID = 'local';

/**
 * Where the local dev server listens, and why `localhost` is in @connect. Must stay a constant:
 * a configurable origin would turn the allowlist into user input.
 */
export const LOCAL_ORIGIN = 'http://localhost:5180';

/**
 * Where a marketplace's files come from. A union so a URL builder must say which kind it has. The
 * `local` arm is the dev server only, never persisted and never built from user input.
 */
export type MarketplaceSource =
  | { kind: 'github'; owner: string; repo: string; ref: string }
  | { kind: 'local'; origin: string };

export interface MarketplaceRef {
  id: string;
  name: string;
  source: MarketplaceSource;
}

/**
 * The built-in marketplace: never persisted, merged in first on every read, never removable.
 * "Official" means official to this loader; the game project does not endorse it.
 */
export const OFFICIAL: MarketplaceRef = Object.freeze({
  id: OFFICIAL_ID,
  name: 'Official Marketplace',
  source: Object.freeze({
    kind: 'github',
    owner: 'MarshalX',
    repo: 'world-of-claudecraft-addons',
    ref: 'HEAD',
  }),
} as const);

/** The dev source, present only while dev mode is on and never persisted. */
export const LOCAL: MarketplaceRef = Object.freeze({
  id: LOCAL_ID,
  name: 'Local dev server',
  source: Object.freeze({ kind: 'local', origin: LOCAL_ORIGIN }),
} as const);

export type NormalizeResult = { ok: true; ref: MarketplaceRef } | { ok: false; error: string };

/**
 * What the host persists for one user-added marketplace. Not the whole ref: the id is the storage
 * namespace of every addon from it, so it is re-derived and re-validated on read, never stored.
 */
export interface StoredMarketplace {
  owner: string;
  repo: string;
  ref: string;
}

/** True for the two sources that ship with the loader and cannot be removed. */
export function isBuiltinMarketplace(id: string): boolean {
  return id === OFFICIAL_ID || id === LOCAL_ID;
}

export function marketplaceId(owner: string, repo: string): string {
  return `gh:${owner}/${repo}`;
}

/** Validate a GitHub owner, repo, and ref, and build the marketplace they name. */
export function githubMarketplace(owner: string, repo: string, ref: string): NormalizeResult {
  if (!(NAME_RE.test(owner) && NAME_RE.test(repo))) {
    return { ok: false, error: 'invalid owner or repository name' };
  }
  if (!REF_RE.test(ref)) {
    return { ok: false, error: 'invalid branch, tag, or commit' };
  }

  const id = marketplaceId(owner, repo);
  if (isBuiltinMarketplace(id)) {
    return { ok: false, error: 'that id is reserved' };
  }

  return {
    ok: true,
    ref: { id, name: `${owner}/${repo}`, source: { kind: 'github', owner, repo, ref } },
  };
}

/** The persistable form of a user-added marketplace, or null for a built-in one. */
export function toStored(market: MarketplaceRef): StoredMarketplace | null {
  const { source } = market;
  if (source.kind === 'local' || isBuiltinMarketplace(market.id)) {
    return null;
  }
  return { owner: source.owner, repo: source.repo, ref: source.ref };
}

/** One persisted record, re-validated. Null for anything that no longer parses. */
export function fromStored(value: unknown): MarketplaceRef | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const { owner, repo, ref } = value as Partial<StoredMarketplace>;
  if (typeof owner !== 'string' || typeof repo !== 'string' || typeof ref !== 'string') {
    return null;
  }
  const built = githubMarketplace(owner, repo, ref);
  if (!built.ok) {
    return null;
  }
  return built.ref;
}

export function indexUrl(market: MarketplaceRef): string {
  return `${marketplaceBase(market.source)}/marketplace.json`;
}

export function fileUrl(market: MarketplaceRef, path: string): string {
  return `${marketplaceBase(market.source)}/${path}`;
}

/** Fallback enumeration for a repository with no marketplace.json. Null for the local source. */
export function contentsApiUrl(market: MarketplaceRef): string | null {
  const { source } = market;
  if (source.kind === 'local') {
    return null;
  }
  const ref = encodeURIComponent(source.ref);
  return `${API_BASE}/repos/${source.owner}/${source.repo}/contents/addons?ref=${ref}`;
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
 * Reduce anything a user might paste to a MarketplaceRef: `owner/repo`, a github.com, `.git`, or
 * tree/blob URL. Every other host is rejected, the dev server's origin included.
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
  return githubMarketplace(owner, parsed.value.repo.replace(GIT_SUFFIX_RE, ''), ref);
}
