// The site's only client-side JavaScript: a theme toggle, copy buttons, and the
// catalog's tag filter.
//
// Every control here is INJECTED rather than written into the markup, so a
// visitor with JavaScript off gets no dead button: no toggle, no copy button, and
// a catalog that is simply the whole grid. The theme still follows
// prefers-color-scheme without this file; the flash-preventing read of the stored
// choice is inline in the head, because an external script cannot run before
// paint whatever its attributes say.

const Key = 'woc-theme';
const FeedbackMs = 1400;

/** The chip that clears the filter. Not a tag, so it cannot collide with one. */
const AllTags = '*';

function systemTheme() {
  if (matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

function current() {
  return document.documentElement.dataset.theme || systemTheme();
}

function other(theme) {
  if (theme === 'light') {
    return 'dark';
  }
  return 'light';
}

function store(theme) {
  try {
    localStorage.setItem(Key, theme);
  } catch {
    // A blocked storage API is not a reason to refuse to change the theme.
  }
}

/** The label names where the click GOES, not where you are. */
function labelFor(destination) {
  if (destination === 'dark') {
    return 'Dark';
  }
  return 'Light';
}

function addThemeToggle() {
  const nav = document.querySelector('.site-nav');
  if (!nav) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-quiet';
  button.setAttribute('aria-label', 'Switch between light and dark');
  const relabel = () => {
    button.textContent = labelFor(other(current()));
  };
  relabel();
  button.addEventListener('click', () => {
    const next = other(current());
    document.documentElement.dataset.theme = next;
    store(next);
    relabel();
  });
  nav.append(button);
}

function headFor(block) {
  const existing = block.querySelector('.code-head');
  if (existing) {
    return existing;
  }
  const head = document.createElement('div');
  head.className = 'code-head';
  head.append(document.createElement('span'));
  block.prepend(head);
  return head;
}

function addCopyButton(block) {
  const pre = block.querySelector('pre');
  if (!pre) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-copy';
  button.textContent = 'Copy';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent ?? '');
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => {
      button.textContent = 'Copy';
    }, FeedbackMs);
  });
  headFor(block).append(button);
}

/** The tags one card declares, from the attribute the generator wrote. */
function tagsOf(card) {
  return (card.dataset.tags ?? '').split(' ').filter(Boolean);
}

/** Every tag on the page, alphabetical, with how many cards carry each. */
function countTags(cards) {
  const counts = new Map();
  for (const card of cards) {
    for (const tag of tagsOf(card)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

function chip(tag, label, count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.dataset.tag = tag;
  button.setAttribute('aria-pressed', String(tag === AllTags));
  button.append(label, Object.assign(document.createElement('span'), { textContent: count }));
  return button;
}

/**
 * Show the cards carrying `tag`, and say how many that is.
 *
 * `hidden` rather than a class, so the cards that are filtered out are out of the
 * accessibility tree too: a screen reader announcing thirty-one cards under a
 * filter reading "combat 8" would be describing a page nobody is looking at.
 */
function applyTag(cards, chips, status, tag) {
  for (const card of cards) {
    card.hidden = tag !== AllTags && !tagsOf(card).includes(tag);
  }
  for (const one of chips) {
    one.setAttribute('aria-pressed', String(one.dataset.tag === tag));
  }
  const shown = cards.filter((card) => !card.hidden).length;
  status.textContent = `${shown} of ${cards.length} addons shown`;
}

function addTagFilter() {
  const grid = document.querySelector('[data-addon-grid]');
  if (!grid) {
    return;
  }
  const cards = [...grid.children];
  const counted = countTags(cards);
  if (counted.length === 0) {
    return;
  }
  const bar = document.createElement('div');
  bar.className = 'filter-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Filter addons by tag');
  const status = document.createElement('p');
  status.className = 'filter-status';
  status.setAttribute('aria-live', 'polite');
  const chips = [
    chip(AllTags, 'All', cards.length),
    ...counted.map(([tag, count]) => chip(tag, tag, count)),
  ];
  for (const one of chips) {
    one.addEventListener('click', () => applyTag(cards, chips, status, one.dataset.tag));
    bar.append(one);
  }
  status.textContent = `${cards.length} of ${cards.length} addons shown`;
  grid.before(bar, status);
}

addThemeToggle();
addTagFilter();
for (const block of document.querySelectorAll('.code')) {
  addCopyButton(block);
}
