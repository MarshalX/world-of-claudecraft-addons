// The install page's content, separated from its markup.
//
// Store URLs and browser-setting instructions are the two things on this site with
// a real shelf life: extension listings move, and the Chromium user-scripts toggle
// has changed both its name and its location across Chrome versions. Keeping them
// as data rather than woven into markup means checking them is reading one table.
//
// Every link below was opened and confirmed to be the right listing on 30 July
// 2026. That check found one bad one, and it is worth recording why it was
// removed rather than corrected: the Safari link pointed at `id1482490089`, which
// is Tampermonkey CLASSIC, superseded by a newer paid app. Both are paid, and this
// loader has never been run on Safari at all, so sending someone to buy an
// extension for an untested browser was the wrong link AND the wrong advice. The
// Safari branch in step 2 now says so instead.

/**
 * When step 2 was last confirmed against current stable, shown on the page.
 *
 * This is the one claim on the site that no test can check: it asserts that a
 * PERSON opened chrome://extensions and read the setting. Bumping the number
 * without doing that makes it look true rather than be true, so change it only
 * alongside a fresh screenshots/chrome-user-scripts.png.
 *
 * Verified 30 July 2026 against Chrome 150.0.7871: the toggle is on an
 * extension's Details page, below Site access, labelled exactly "Allow User
 * Scripts".
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
