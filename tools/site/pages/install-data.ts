// The install page's content, kept as data because store listings and the Chromium user-scripts
// toggle move between versions. No Safari link: the loader is untested there and every Safari
// manager is paid.

/**
 * When a person last confirmed step 2 against stable Chrome, shown on the page. Change it only
 * alongside a fresh screenshots/chrome-user-scripts.png. In Chrome 150 the toggle is on the
 * extension's Details page, below Site access, labelled "Allow User Scripts".
 */
export const CHROME_CHECKED = { version: '150', date: 'July 2026' } as const;

export const MANAGERS = [
  {
    name: 'Violentmonkey',
    note: 'Open source. Recommended.',
    links: [
      {
        label: 'Chrome / Edge / Brave',
        href: 'https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag',
      },
      { label: 'Firefox', href: 'https://addons.mozilla.org/firefox/addon/violentmonkey/' },
    ],
  },
  {
    name: 'Tampermonkey',
    note: 'The one most guides assume.',
    links: [
      {
        label: 'Chrome / Edge / Brave',
        href: 'https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo',
      },
      { label: 'Firefox', href: 'https://addons.mozilla.org/firefox/addon/tampermonkey/' },
    ],
  },
  {
    name: 'Greasemonkey',
    note: 'Firefox only, and best effort. The loader has no value-change listener there, so cross-tab sync runs over a BroadcastChannel fallback. If you are on Firefox, use Violentmonkey.',
    links: [{ label: 'Firefox', href: 'https://addons.mozilla.org/firefox/addon/greasemonkey/' }],
  },
] as const;

export const STEPS = [
  { id: 'step-1', n: '1', name: 'Userscript manager', qualifier: null },
  { id: 'step-2', n: '2', name: 'Allow user scripts', qualifier: 'Chromium only' },
  { id: 'step-3', n: '3', name: 'Install the loader', qualifier: null },
] as const;

export const TROUBLE = [
  {
    symptom: 'No <strong>Addons</strong> entry in the menu',
    cause: 'The HUD only exists after world entry. Log in first, then press Esc.',
  },
  {
    symptom: "The manager's popup has no <strong>Addons</strong> command",
    cause:
      'The userscript is not running on this page at all. Go back to <a href="#step-2">step 2</a>.',
  },
  {
    symptom: 'The entry is there, the window is empty',
    cause:
      'The bridge did not connect. Open <strong>Diagnostics</strong>, then file an issue with what it says.',
  },
  {
    symptom: 'Everything works, no addons listed',
    cause: 'Nothing is installed by default. Open <strong>Browse</strong>, then install.',
  },
] as const;
