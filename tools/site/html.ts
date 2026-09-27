// The site's only injection surface. Addon names and descriptions are data, and a third-party
// index is attacker-controlled, so interpolation escapes by default and raw() is the opt-out. A
// value that is already Html passes through, so templates nest without double escaping.

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
 * One interpolated value, resolved to markup. null, undefined and false render as nothing, so
 * `${cond && html`...`}` works; 0 renders, since a zero count is a real value.
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
 * Mark a string as already-safe markup, skipping escaping. Only for this module's own output,
 * markdown-it's render and shiki's, which all escape their inputs.
 */
export function raw(value: string): Html {
  return { html: value };
}

/** Join a list of fragments with a separator, escaping any plain strings in it. */
export function join(parts: readonly unknown[], separator = ''): Html {
  return raw(parts.map(resolve).join(separator));
}

/**
 * Build markup, escaping every interpolation that is not already Html. Returning Html lets `tsc`
 * catch a bare string where markup was meant.
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
