// The userscript's `@icon`. A directive that wraps ends the metadata block early without
// an error. The mark is read through the tool so node:fs stays where noNodejsModules is exempt.

import { describe, expect, it } from 'vitest';
import { loaderIcon } from '../tools/brand.ts';

const PREFIX = 'data:image/svg+xml;base64,';

function decoded(): string {
  return atob(loaderIcon().slice(PREFIX.length));
}

describe('loaderIcon', () => {
  it('is a base64 svg data URI', () => {
    expect(loaderIcon().startsWith(PREFIX)).toBe(true);
  });

  it('is one line, so the metadata block cannot end inside it', () => {
    expect(loaderIcon()).not.toMatch(/\s/);
  });

  it('decodes to the mark the site serves as its favicon', () => {
    expect(decoded()).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(decoded()).toContain('rotate(45 16 16)');
  });

  it('carries the label a manager reads out', () => {
    expect(decoded()).toContain('aria-label="ClaudeCraft Addons"');
  });

  it('stays small', () => {
    // The metadata block is `@updateURL`'s whole payload, fetched on every update check.
    expect(loaderIcon().length).toBeLessThan(2048);
  });
});
