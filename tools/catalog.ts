// The one reading of `addons/` that the site and the README publish from, through the same
// `readAddon` that `pnpm validate` uses. An invalid manifest is left out rather than failing the
// build, since reporting it is `pnpm validate`'s job.

import type { AddonManifest, KeybindDecl, SettingDecl } from '../loader/src/shared/schema.ts';
import { addonDirs, readAddon } from './manifests.ts';

/**
 * The tag that marks an addon as a tool for addon AUTHORS. Such an addon ships and is in Browse, but
 * is left off the player catalog; the catalog page names what it left out.
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
    settings: manifest.settings ?? [],
    keybinds: manifest.keybinds ?? [],
    companions: manifest.companions ?? [],
    companionReasons: manifest.companionReasons ?? {},
  };
}

/** Whether an addon is an author tool rather than something a player installs. */
function isAuthorTool(addon: CatalogAddon): boolean {
  return addon.tags.includes(AUTHOR_TOOL_TAG);
}

/** Every valid addon in `addons/`, in directory order. Author tools are included; callers filter. */
function readAddons(): CatalogAddon[] {
  return addonDirs().flatMap((dir) => {
    const result = readAddon(dir);
    if (!result.ok) {
      return [];
    }
    return [row(result.manifest)];
  });
}

/** The natural width of a PNG, read from its header. `readAddon` has already checked the signature. */
function pngWidth(bytes: Buffer): number {
  return bytes.readUInt32BE(PNG_WIDTH_OFFSET);
}

/** An addon's screenshot, as its own manifest declares it. */
interface CatalogPreview {
  readonly file: string;
  readonly alt: string;
}

/** One addon as everything downstream of the manifests sees it, without `entry` and the like. */
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
  /** Settings and keybinds exactly as declared, since the loader builds its panes from the same. */
  readonly settings: readonly SettingDecl[];
  readonly keybinds: readonly KeybindDecl[];
  /** Addon ids this one works better with. A note, never a dependency. */
  readonly companions: readonly string[];
  /** What each of them adds, keyed by that id. Empty for a companion named without one. */
  readonly companionReasons: Readonly<Record<string, string>>;
}

export type { CatalogAddon, CatalogPreview };
export { AUTHOR_TOOL_TAG, isAuthorTool, pngWidth, readAddons };
