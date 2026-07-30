// Where the userscript build lands, named once.
//
// Two halves of the repository have to agree about this file and neither would
// notice the other drifting. Vite writes it, and the dev server hands it out so a
// manager can install the loader from a URL instead of a file path. A rename on
// one side leaves `pnpm dev` answering 404 for the loader while the build
// reports success, which reads as a broken server rather than as a rename.
//
// Two constants rather than one joined path: vite wants the directory and the
// file name as separate options, so joining them here would only mean splitting
// them again at the one place that cannot.

/** Vite's `build.outDir`, relative to the repository root. */
const LOADER_OUT_DIR = 'loader/dist';

/**
 * Vite's userscript `build.fileName`.
 *
 * The `.user.js` suffix is not decoration: it is what makes a userscript manager
 * intercept the URL and offer to install rather than showing the source.
 */
const LOADER_FILENAME = 'woc-loader.user.js';

export { LOADER_FILENAME, LOADER_OUT_DIR };
