// Three scalars at the top of a Markdown file, parsed by hand.
//
// Not YAML, and not a YAML dependency: the fields are a string, an integer and a
// string, and a real parser would be a large dependency for `key: value`. The
// cost of hand-parsing is that the accepted syntax has to be small and strict,
// which it is below, and the benefit is that an unknown key is a build failure
// rather than a field that silently does nothing.
//
// `order` alone drives the docs sidebar, the aria-current state and the prev/next
// pagination, so adding a docs page is adding one file with no index to update.
// That is the thing that rots first in a docs section, and this is why it cannot.

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const LINE = /^([a-z]+):\s*(.*)$/;
const QUOTED = /^(["'])([\s\S]*)\1$/;
const INTEGER = /^\d+$/;
const NEWLINE = /\r?\n/;

const REQUIRED = ['title', 'order', 'summary'] as const;

type Key = (typeof REQUIRED)[number];

function unquote(value: string): string {
  const match = QUOTED.exec(value.trim());
  return match?.[2] ?? value.trim();
}

function parseField(line: string, at: string): [Key, string] {
  const match = LINE.exec(line);
  const [, key, value] = match ?? [];
  if (!key) {
    throw new Error(`${at}: frontmatter line is not \`key: value\`: ${line}`);
  }
  if (!(REQUIRED as readonly string[]).includes(key)) {
    throw new Error(`${at}: unknown frontmatter key \`${key}\`, expected one of ${REQUIRED}`);
  }
  return [key as Key, unquote(value ?? '')];
}

function readFields(block: string, at: string): Map<Key, string> {
  const fields = new Map<Key, string>();
  for (const line of block.split(NEWLINE).filter((one) => one.trim() !== '')) {
    const [key, value] = parseField(line, at);
    if (fields.has(key)) {
      throw new Error(`${at}: duplicate frontmatter key \`${key}\``);
    }
    fields.set(key, value);
  }
  return fields;
}

function readOrder(fields: Map<Key, string>, at: string): number {
  const order = fields.get('order') ?? '';
  if (!INTEGER.test(order)) {
    throw new Error(`${at}: \`order\` must be a non-negative integer, got \`${order}\``);
  }
  return Number(order);
}

/**
 * Split a Markdown file into its frontmatter and its body.
 *
 * `at` names the file in every error, because the whole value of failing here is
 * that the message says which page is wrong.
 */
export function parseFrontmatter(source: string, at: string): Page {
  const match = FENCE.exec(source);
  if (!match?.[1]) {
    throw new Error(`${at}: missing frontmatter, expected a --- fenced block at the top`);
  }
  const fields = readFields(match[1], at);
  for (const key of REQUIRED) {
    if (!fields.get(key)) {
      throw new Error(`${at}: frontmatter is missing \`${key}\``);
    }
  }
  return {
    title: fields.get('title') ?? '',
    summary: fields.get('summary') ?? '',
    order: readOrder(fields, at),
    body: source.slice(match[0].length),
  };
}

/** A Markdown page, split. */
export interface Page {
  readonly title: string;
  readonly summary: string;
  /** Position in the docs sidebar, and therefore in the prev/next pagination. */
  readonly order: number;
  readonly body: string;
}
