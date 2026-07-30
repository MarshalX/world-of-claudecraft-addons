// The site's only injection surface, and the reason it is a tagged template.
//
// Page content is assembled from data the repository holds rather than from
// hand-written markup: addon names, authors and descriptions come out of
// marketplace.json, and a third-party marketplace's index is attacker-controlled
// by definition. So interpolation escapes by DEFAULT and raw() is the explicit
// opt-out, rather than the other way round. A template that forgets to escape is
// then impossible to write by accident; one that needs markup has to say so.
//
// A value that is already Html passes through untouched, which is what makes
// composition work: html`<div>${html`<p>x</p>`}</div>` nests without double
// escaping, and no caller has to know which of its children were escaped.

const ESCAPABLE = /["&'<>]/g;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function isHtml(value: unknown): value is Html {
  return typeof value === 'object' && value !== null && 'html' in value;
}

/**
 * One interpolated value, resolved to markup.
 *
 * null and undefined render as nothing rather than as the strings "null" and
 * "undefined", because an optional field left unset is the common case and
 * printing its absence is never what a template meant. false renders as nothing
 * for the same reason, which is what makes `${cond && html`...`}` read correctly;
 * 0 does not, since a zero count is a real value a page may want to show.
 */
function resolve(value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return '';
  }
  if (isHtml(value)) {
    return value.html;
  }
  if (Array.isArray(value)) {
    return value.map(resolve).join('');
  }
  return escapeHtml(String(value));
}

/** Escape the five characters that can change the meaning of markup. */
function escapeHtml(value: string): string {
  return value.replace(ESCAPABLE, (char) => ESCAPES[char] ?? char);
}

/**
 * Mark a string as already-safe markup, skipping escaping.
 *
 * Every call is a claim that the string cannot carry attacker-controlled markup.
 * The legitimate sources are this module's own output, markdown-it's render (which
 * escapes its own inputs), and shiki's, which does the same.
 */
export function raw(value: string): Html {
  return { html: value };
}

/** Join a list of fragments with a separator, escaping any plain strings in it. */
export function join(parts: readonly unknown[], separator = ''): Html {
  return raw(parts.map(resolve).join(separator));
}

/**
 * Build markup, escaping every interpolation that is not already Html.
 *
 * The tag returns Html rather than a string so that a template which forgets to
 * mark its output cannot be silently re-escaped by the template that includes it,
 * and so that `tsc` catches a page handed a bare string where markup was meant.
 */
export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): Html {
  let out = strings[0] ?? '';
  for (const [index, value] of values.entries()) {
    out += resolve(value) + (strings[index + 1] ?? '');
  }
  return raw(out);
}

/** The final step before a file is written: unwrap markup back to a string. */
export function render(markup: Html): string {
  return markup.html;
}

export { escapeHtml };

/** Markup that is already safe to emit: either escaped, or explicitly trusted. */
export interface Html {
  readonly html: string;
}
