import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { LOADER_FILENAME, LOADER_META_FILENAME, LOADER_OUT_DIR } from './tools/artifact.ts';
import { loaderIcon } from './tools/brand.ts';

const HOSTS = [
  'https://worldofclaudecraft.com/*',
  'https://pbe.worldofclaudecraft.com/*',
  'https://pbe2.worldofclaudecraft.com/*',
];

// The release asset is the one canonical copy of the loader; nothing else may host
// it. loader/dist/ is never committed, so a raw.githubusercontent.com URL would be
// a 404, and a manager whose update URL 404s silently never updates.
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
        // FROZEN: `name` and `namespace`. A manager keys a script's identity and
        // its whole GM store on this pair, so changing either installs a new script
        // with an empty registry beside the old one, and every player loses their
        // addons, settings, keybinds and window positions. release.yml greps the
        // built block for both. Everything else here is free to change.
        name: 'World of ClaudeCraft Addon Loader',
        namespace: 'woc-addons',
        description: 'Addon platform for World of ClaudeCraft',
        author: 'MarshalX',
        license: 'MIT',
        // Inlined from site/static/favicon.svg at build time; see tools/brand.ts.
        icon: loaderIcon(),
        match: HOSTS,
        'run-at': 'document-start',
        // Violentmonkey-only. The page realm is reached by injecting a <script>,
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
        // No `@version` here: it falls back to package.json, which stays 0.0.0 in
        // git. The git tag is the only source of a release version, and
        // release.yml stamps it with `pnpm pkg set` before building.
        downloadURL: `${RELEASE_BASE}/${LOADER_FILENAME}`,
        // The metadata block alone, so an update check skips the whole bundle.
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
