// The addon list the site and the README both publish, and the one rule that
// decides what is on it.
//
// Read through the same `readAddon` that `pnpm validate` and `pnpm index` use, so
// nothing published here can describe an addon the loader would refuse. An addon
// whose manifest fails validation is left OUT rather than failing the build:
// reporting a broken manifest is `pnpm validate`'s job, and a site build that
// died on one would report it in the wrong place.
//
// This module exists because the catalog page, the landing page and the README
// were three independent readings of the same directory, and the moment they
// disagree about which addons ship is the moment one of them is wrong.

import type { AddonManifest } from '../loader/src/shared/schema.ts';
import { addonDirs, readAddon } from './manifests.ts';

/**
 * The tag that marks an addon as a tool for addon AUTHORS.
 *
 * A player installs an addon to play with it; `dev-harness` exists to exercise
 * every API surface against a live game and report what it found, which is a
 * thing only somebody writing an addon or the loader wants. It ships, it is in
 * the in-game Browse, and it is deliberately not in the catalog a player reads.
 *
 * Derived from the manifest rather than from a list of ids here, so an author
 * tool added later is off the catalog the day it lands rather than the day
 * somebody remembers this file. The two consumers both filter on it, and the
 * catalog page names what it left out rather than quietly shortening its count.
 */
const AUTHOR_TOOL_TAG = 'development';

/** What one addon's PNG says it is, without decoding it. IHDR is fixed-offset. */
const PNG_WIDTH_OFFSET = 16;

function previewOf(manifest: AddonManifest): CatalogPreview | null {
  if (manifest.preview === undefined) {
    return null;
  }
  return { file: manifest.preview.file, alt: manifest.preview.alt };
}

function row(manifest: AddonManifest): CatalogAddon {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    tags: manifest.tags ?? [],
    permissions: manifest.permissions ?? [],
    preview: previewOf(manifest),
  };
}

/** Whether an addon is an author tool rather than something a player installs. */
function isAuthorTool(addon: CatalogAddon): boolean {
  return addon.tags.includes(AUTHOR_TOOL_TAG);
}

/**
 * Every addon in `addons/`, valid ones only, in directory order.
 *
 * Author tools are INCLUDED here and filtered by the caller, because the two
 * consumers want different things from them: the catalog page names them in a
 * line saying what it is not listing, and the README leaves them to the docs.
 */
function readAddons(): CatalogAddon[] {
  return addonDirs().flatMap((dir) => {
    const result = readAddon(dir);
    if (!result.ok) {
      return [];
    }
    return [row(result.manifest)];
  });
}

/**
 * The natural width of a PNG, in pixels, read from its header.
 *
 * Ten bytes of arithmetic rather than a decoder, because the only consumer is the
 * README, which needs a display width that does not upscale a small panel. Every
 * file reaching this has already been checked to BE a PNG by `readAddon`, which
 * verifies the signature rather than the extension.
 */
function pngWidth(bytes: Buffer): number {
  return bytes.readUInt32BE(PNG_WIDTH_OFFSET);
}

/** An addon's screenshot, as its own manifest declares it. */
interface CatalogPreview {
  readonly file: string;
  readonly alt: string;
}

/**
 * One addon as everything downstream of the manifests sees it.
 *
 * A flat projection rather than the manifest itself, so a page cannot reach for
 * `entry` or `keybinds` and quietly make an implementation detail public.
 */
interface CatalogAddon {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly permissions: readonly string[];
  /** Absent is ordinary: publishing an addon is not gated on taking a picture. */
  readonly preview: CatalogPreview | null;
}

export type { CatalogAddon, CatalogPreview };
export { AUTHOR_TOOL_TAG, isAuthorTool, pngWidth, readAddons };
