import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { LOADER_FILENAME, LOADER_META_FILENAME, LOADER_OUT_DIR } from './tools/artifact.ts';

const HOSTS = [
  'https://worldofclaudecraft.com/*',
  'https://pbe.worldofclaudecraft.com/*',
  'https://pbe2.worldofclaudecraft.com/*',
];

// The release asset is the one canonical copy of the loader, and `latest` is a
// redirect GitHub maintains. Nothing else may host it: two locations for one
// file is two things that can drift, and the one nobody watches goes stale.
//
// The previous scheme pointed both URLs at raw.githubusercontent.com on `HEAD`,
// which .gitignore excludes, so it was a 404 that no manager reports: a player
// whose update URL 404s gets no error, no badge, and no updates ever.
const RELEASE_BASE =
  'https://github.com/MarshalX/world-of-claudecraft-addons/releases/latest/download';

// Vite builds the sandbox half, the userscript itself. The page-realm runtime is
// pre-bundled by loader/build-runtime.mjs and inlined by the host via ?raw.
export default defineConfig({
  build: {
    outDir: LOADER_OUT_DIR,
    emptyOutDir: true,
  },
  plugins: [
    monkey({
      entry: 'loader/src/host/main.ts',
      userscript: {
        // FROZEN AT FIRST RELEASE. A userscript manager keys a script's
        // identity, and therefore its whole GM value store, on the name and
        // namespace pair. Changing either is not a rename: it is a new script
        // with an empty registry, so every player loses their installed addons,
        // settings, keybinds and saved window positions while the old script
        // sits alongside it still running. Same rule AGENTS.md states for an
        // addon id, one level up. The release workflow greps the built block
        // for both. Everything else here is free to change.
        name: 'World of ClaudeCraft Addon Loader',
        namespace: 'woc-addons',
        description: 'Addon platform for World of ClaudeCraft',
        author: 'MarshalX',
        license: 'MIT',
        match: HOSTS,
        'run-at': 'document-start',
        // Violentmonkey-only key, ignored by other managers. The page realm is
        // reached by injecting a <script>, not by running the userscript there,
        // so the sandbox keeps its GM references private.
        'inject-into': 'auto',
        // Enforced by Tampermonkey, advisory elsewhere.
        connect: ['raw.githubusercontent.com', 'api.github.com', 'localhost'],
        // Both spellings of every grant: Greasemonkey 4 has only the GM.* names,
        // and a manager ignores a grant it does not recognize.
        grant: [
          'GM.getValue',
          'GM.setValue',
          'GM.deleteValue',
          'GM.listValues',
          'GM.xmlHttpRequest',
          'GM.registerMenuCommand',
          'GM_getValue',
          'GM_setValue',
          'GM_deleteValue',
          'GM_listValues',
          'GM_addValueChangeListener',
          'GM_removeValueChangeListener',
          'GM_xmlhttpRequest',
          'GM_registerMenuCommand',
        ],
        // `@version` is not set here. vite-plugin-monkey falls back to the root
        // package.json, which stays at 0.0.0 in git on purpose: the git tag is
        // the only source of a release version, and the release workflow stamps
        // it in with `pnpm pkg set` before building. A local build therefore
        // reports 0.0.0, which is exactly what an unreleased build is.
        downloadURL: `${RELEASE_BASE}/${LOADER_FILENAME}`,
        // The metadata block alone, so an update check is a few hundred bytes
        // rather than the whole bundle.
        updateURL: `${RELEASE_BASE}/${LOADER_META_FILENAME}`,
        supportURL: 'https://github.com/MarshalX/world-of-claudecraft-addons/issues',
        homepageURL: 'https://github.com/MarshalX/world-of-claudecraft-addons',
      },
      build: {
        fileName: LOADER_FILENAME,
        metaFileName: LOADER_META_FILENAME,
      },
    }),
  ],
  resolve: {
    alias: {
      '#shared': `${import.meta.dirname}/loader/src/shared`,
    },
  },
});
