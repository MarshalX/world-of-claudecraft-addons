// woc.data, page-realm half: the membership check, the parse, and the memo. Fetching is the host's
// and is covered in tests/host-registry.test.ts.

import { describe, expect, it, vi } from 'vitest';
import { createData } from '../loader/src/runtime/api/data.ts';

const FQID = 'official/lorebind';
const ITEMS = '{"sword":"Sword"}';

function reader(files: Record<string, string>) {
  return vi.fn((_fqid: string, name: string) => {
    const text = files[name];
    if (text === undefined) {
      return Promise.reject(new Error(`no such file ${name}`));
    }
    return Promise.resolve(text);
  });
}

describe('reading a declared file', () => {
  it('parses the host copy', async () => {
    const data = createData({
      fqid: FQID,
      declared: ['items.json'],
      read: reader({ 'items.json': ITEMS }),
    });

    await expect(data('items.json')).resolves.toEqual({ sword: 'Sword' });
  });

  it('makes one host read and one parse however many times it is called', async () => {
    const read = reader({ 'items.json': ITEMS });
    const data = createData({ fqid: FQID, declared: ['items.json'], read });

    const [first, second] = await Promise.all([data('items.json'), data('items.json')]);
    await data('items.json');

    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  // Documented behaviour: changing to deep-freeze or re-parse must be deliberate.
  it('hands back the same object every time, so a mutation is visible', async () => {
    const data = createData({
      fqid: FQID,
      declared: ['items.json'],
      read: reader({ 'items.json': ITEMS }),
    });

    const first = (await data('items.json')) as Record<string, string>;
    // Computed, because noPropertyAccessFromIndexSignature forbids dotting into
    // a Record and useLiteralKeys forbids the literal at a call site.
    const key = 'sword';
    first[key] = 'Edited';

    await expect(data('items.json')).resolves.toEqual({ sword: 'Edited' });
  });
});

describe('refusing a name', () => {
  it('rejects an undeclared name and says what is declared', async () => {
    const read = reader({ 'items.json': ITEMS });
    const data = createData({ fqid: FQID, declared: ['items.json'], read });

    await expect(data('zones.json')).rejects.toThrow(/Declared: items\.json/);
    expect(read).not.toHaveBeenCalled();
  });

  // The name is checked for membership, never joined onto a URL.
  it('rejects a traversing name like any other undeclared one', async () => {
    const data = createData({ fqid: FQID, declared: ['items.json'], read: reader({}) });

    await expect(data('../../secrets.json')).rejects.toThrow(/is not declared/);
  });

  it('says so plainly when the addon declared nothing at all', async () => {
    const data = createData({ fqid: FQID, declared: undefined, read: reader({}) });

    await expect(data('items.json')).rejects.toThrow(/Declared: nothing/);
  });

  // Comlink turns a throw into a rejection, so throwing here would behave differently by caller.
  it('rejects rather than throwing, even for a name it refuses immediately', async () => {
    const data = createData({ fqid: FQID, declared: [], read: reader({}) });
    let refused: Promise<unknown> | null = null;

    expect(() => {
      refused = data('items.json');
    }).not.toThrow();

    await expect(refused).rejects.toThrow(/is not declared/);
  });
});

describe('a read that failed', () => {
  it('is not memoised, so a later call tries again', async () => {
    const files: Record<string, string> = {};
    const read = reader(files);
    const data = createData({ fqid: FQID, declared: ['items.json'], read });

    await expect(data('items.json')).rejects.toThrow(/no such file/);
    files['items.json'] = ITEMS;

    await expect(data('items.json')).resolves.toEqual({ sword: 'Sword' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('names the file when the host copy is not valid JSON', async () => {
    const data = createData({
      fqid: FQID,
      declared: ['items.json'],
      read: reader({ 'items.json': 'not json' }),
    });

    await expect(data('items.json')).rejects.toThrow(/items\.json is not valid JSON/);
  });

  // A bland failure would send the author to debug their own file.
  it('carries the loader-not-connected message through from the reader', async () => {
    const data = createData({
      fqid: FQID,
      declared: ['items.json'],
      read: () => Promise.reject(new Error(`${FQID}: woc.data is unavailable, the loader never`)),
    });

    await expect(data('items.json')).rejects.toThrow(/woc\.data is unavailable/);
  });
});
