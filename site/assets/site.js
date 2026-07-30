// The site's only client-side JavaScript: a theme toggle and copy buttons.
//
// Both controls are INJECTED rather than written into the markup, so a visitor
// with JavaScript off gets no dead button. The theme still follows
// prefers-color-scheme without this file; the flash-preventing read of the stored
// choice is inline in the head, because an external script cannot run before
// paint whatever its attributes say.

const Key = 'woc-theme';
const FeedbackMs = 1400;

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

addThemeToggle();
for (const block of document.querySelectorAll('.code')) {
  addCopyButton(block);
}
