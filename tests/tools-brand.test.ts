// The userscript's `@icon`, and the two ways it can be wrong in silence.
//
// Both failures this covers are invisible at the point they happen. A metadata
// directive that runs onto a second line does not raise: the block simply ends
// early, and everything after it is source, so the loader still installs and
// still runs while whatever followed `@icon` has quietly stopped applying. And
// an icon that decodes to something other than the committed mark is a picture
// nobody looks at twice, because a wrong icon and a right one occupy the same
// 24 pixels in a manager's list.
//
// The mark itself is read through the tool rather than imported here, which is
// the same arrangement `tools/site/root.ts` explains: node:fs stays on the side
// of the boundary where noNodejsModules is exempt.

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

  it('carries the label a manager reads out, not just the shape', () => {
    expect(decoded()).toContain('aria-label="ClaudeCraft Addons"');
  });

  it('stays small enough to sit in every build of both artifacts', () => {
    // The metadata block is also `@updateURL`'s whole payload, fetched on every
    // update check. A mark that grew into a bitmap would be paid there.
    expect(loaderIcon().length).toBeLessThan(2048);
  });
});
