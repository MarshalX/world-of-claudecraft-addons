// What a declared data file may weigh. Shared because host/addon-data.ts enforces it at install
// and tools/manifests.ts in CI, and a second copy of the number would drift. Half a megabyte,
// like a preview: the player waits for it during install and it then sits in GM storage.

export const DATA_MAX_BYTES = 524_288;
