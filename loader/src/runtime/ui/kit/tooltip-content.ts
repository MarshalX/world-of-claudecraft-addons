// What goes INSIDE a tooltip, as opposed to where the tooltip goes.
//
// kit/tooltip.ts owns the shared element, placement and lifecycle; this owns the markup, as
// a function from content to nodes. A plain string is still a whole tooltip.
//
// Every node is built with textContent: wire text reaches this, and innerHTML would be script
// injection into the game's page.

const TONES = Object.freeze(['default', 'muted', 'good', 'warn', 'danger'] as const);

/**
 * What a line MEANS, as the game's own tooltips distinguish lines. Its own union, not the
 * readout's tone, which is urgency.
 */
type TooltipTone = (typeof TONES)[number];

interface TooltipLine {
  text: string;
  /** Defaults to 'default'. An unrecognised value falls back to it too. */
  tone?: TooltipTone;
}

interface TooltipContent {
  /** The name of the thing, drawn in the game's own heading colour. */
  title?: string;
  /** An icon URL, from `ui.icon`, beside the title. Null draws none. */
  icon?: string | null;
  /** The body, one paragraph per entry. A bare string is a line at the default tone. */
  lines?: readonly (string | TooltipLine)[];
}

/**
 * A line of text, the whole tooltip, or a function returning either. The function form is
 * resolved WHEN THE TOOLTIP IS SHOWN, so a live readout's tooltip carries current numbers
 * without re-attaching on every repaint.
 */
type TooltipInput = string | TooltipContent | (() => string | TooltipContent);

function toneClass(tone: unknown): string {
  if (typeof tone === 'string' && (TONES as readonly string[]).includes(tone)) {
    return `woc-tip-${tone}`;
  }
  return `woc-tip-${TONES[0]}`;
}

function lineOf(entry: string | TooltipLine): TooltipLine {
  if (typeof entry === 'string') {
    return { text: entry };
  }
  return entry;
}

/**
 * The head: the icon and the title, or nothing. The icon hides on a failed load, as a bar's does.
 */
function buildHead(doc: Document, content: TooltipContent): HTMLElement | null {
  if (content.title === undefined && (content.icon ?? null) === null) {
    return null;
  }
  const head = doc.createElement('div');
  head.className = 'woc-tip-head';

  if ((content.icon ?? null) !== null) {
    const icon = doc.createElement('img');
    icon.className = 'woc-tip-icon';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.addEventListener('error', () => {
      icon.hidden = true;
    });
    icon.src = content.icon ?? '';
    head.appendChild(icon);
  }

  if (content.title !== undefined) {
    const title = doc.createElement('span');
    title.className = 'woc-tip-title';
    title.textContent = content.title;
    head.appendChild(title);
  }
  return head;
}

/** The content itself, asking for it first when what was given was a function. */
function resolve(input: TooltipInput): string | TooltipContent {
  if (typeof input === 'function') {
    return input();
  }
  return input;
}

/** A string is one line at the default tone. */
function asContent(input: TooltipInput): TooltipContent {
  const resolved = resolve(input);
  if (typeof resolved === 'string') {
    return { lines: [resolved] };
  }
  return resolved;
}

/**
 * Render content into the shared tooltip element. `replaceChildren` in one operation, so a line
 * that throws cannot leave it half-filled.
 */
function renderTooltip(doc: Document, tip: HTMLElement, input: TooltipInput): void {
  const content = asContent(input);
  const nodes: HTMLElement[] = [];

  const head = buildHead(doc, content);
  if (head !== null) {
    nodes.push(head);
  }

  for (const entry of content.lines ?? []) {
    const line = lineOf(entry);
    const el = doc.createElement('p');
    el.className = `woc-tip-line ${toneClass(line.tone)}`;
    el.textContent = line.text;
    nodes.push(el);
  }

  tip.replaceChildren(...nodes);
}

export type { TooltipContent, TooltipInput, TooltipLine, TooltipTone };
export { renderTooltip, TONES as TOOLTIP_TONES };
