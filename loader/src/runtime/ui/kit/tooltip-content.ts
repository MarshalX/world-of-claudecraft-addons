// What goes INSIDE a tooltip, as opposed to where the tooltip goes.
//
// Split from kit/tooltip.ts because the two answer different questions and change
// for different reasons: that file owns one shared element, its placement, and the
// attachment lifecycle; this one owns markup. The seam is a function from content
// to nodes, which is also what makes the content testable without a pointer.
//
// A plain string is still a tooltip. `ui.tooltip(el, 'Toggle the meter')` was the
// whole surface before this and remains the common case, so it is the SAME call
// rather than a legacy one: an addon that wants a line of text writes a line of
// text, and a published surface that changed shape here would have moved the API
// major for no gain to anyone.
//
// Every node is built with textContent. An ability name, a player name and a
// number off the wire all reach this, and innerHTML on any of them is script
// injection into a page that is also running the game.

const TONES = Object.freeze(['default', 'muted', 'good', 'warn', 'danger'] as const);

/**
 * What a line MEANS, which is not what a bar's tone means.
 *
 * Deliberately its own union rather than the readout's, even though three names
 * overlap. A bar's tone is urgency, and urgency is the only thing a fill can say;
 * a tooltip line is prose, and the useful distinctions there are the ones the
 * game's own tooltips draw: flavour text is quieter than the rules, a requirement
 * you meet reads differently from one you do not. There is no fill in the world
 * that wants to be 'muted', and no line that wants to be a percentage.
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
 * A line of text, the whole tooltip, or a function returning either.
 *
 * The function form is resolved WHEN THE TOOLTIP IS SHOWN, and it is what a live
 * readout needs: a meter row's tooltip has to carry the numbers as they are under
 * the pointer, and an attachment fixed at build time carries the numbers as they
 * were when the row was created. The alternative an addon would reach for is
 * detaching and re-attaching on every repaint, which is a listener swap per row
 * per frame to answer a question nobody asked unless they are hovering.
 *
 * It also costs less than the static form for anything that changes: content is
 * built for the one row being pointed at rather than for every row on screen.
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
 * The head: the icon and the title, or nothing.
 *
 * The icon slot hides itself on a failed load exactly as a bar's does, since the
 * same ability may have no painted art, and a broken-image glyph in a tooltip is
 * worse than a tooltip with no icon.
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

/** A string is one line at the default tone, which is what the old surface drew. */
function asContent(input: TooltipInput): TooltipContent {
  const resolved = resolve(input);
  if (typeof resolved === 'string') {
    return { lines: [resolved] };
  }
  return resolved;
}

/**
 * Render content into the shared tooltip element, replacing whatever was there.
 *
 * `replaceChildren` rather than clearing and appending: one operation, and it
 * cannot leave the element half-filled if a line throws on the way.
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
