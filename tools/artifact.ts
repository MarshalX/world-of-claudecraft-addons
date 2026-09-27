// Where the userscript build lands. Vite writes it and the dev server serves it, so a rename on
// one side alone leaves `pnpm dev` answering 404 while the build reports success.

/** Vite's `build.outDir`, relative to the repository root. */
const LOADER_OUT_DIR = 'loader/dist';

/** Vite's userscript `build.fileName`. The `.user.js` suffix is what makes a manager offer to install. */
const LOADER_FILENAME = 'woc-loader.user.js';

/**
 * Vite's userscript `build.metaFileName`: the metadata block alone, which `@updateURL` points at.
 * Passed to vite explicitly rather than as `true` because the release workflow attaches it by name.
 */
const LOADER_META_FILENAME = LOADER_FILENAME.replace(/\.user\.js$/, '.meta.js');

export { LOADER_FILENAME, LOADER_META_FILENAME, LOADER_OUT_DIR };
