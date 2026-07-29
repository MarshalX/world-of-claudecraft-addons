import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const HOSTS = [
  'https://worldofclaudecraft.com/*',
  'https://pbe.worldofclaudecraft.com/*',
  'https://pbe2.worldofclaudecraft.com/*',
];

const RAW_BASE =
  'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD/loader/dist';

// Vite builds the sandbox half, the userscript itself. The page-realm runtime is
// pre-bundled by loader/build-runtime.mjs and inlined by the host via ?raw.
export default defineConfig({
  build: {
    outDir: 'loader/dist',
    emptyOutDir: true,
  },
  plugins: [
    monkey({
      entry: 'loader/src/host/main.ts',
      userscript: {
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
        downloadURL: `${RAW_BASE}/woc-loader.user.js`,
        updateURL: `${RAW_BASE}/woc-loader.user.js`,
        supportURL: 'https://github.com/MarshalX/world-of-claudecraft-addons/issues',
        homepageURL: 'https://github.com/MarshalX/world-of-claudecraft-addons',
      },
      build: {
        fileName: 'woc-loader.user.js',
      },
    }),
  ],
  resolve: {
    alias: {
      '#shared': `${import.meta.dirname}/loader/src/shared`,
    },
  },
});
