// woc.data: the membership check, the parse, and the memo.
//
// Everything about fetching a data file is the host's, and is covered in
// tests/host-registry.test.ts. What is left here is the page-realm half, and
// every case below is a defect an addon author would experience rather than a
// restatement of the code: a name refused with no hint of what was declared, a
// table parsed once per read, a rejection cached so a recoverable failure never
// recovers, and a missing bridge answering as though the addon's own file were
// broken.

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

  // A table an addon reads on several code paths must not cost a bridge round
  // trip and a JSON.parse each time.
  it('makes one host read and one parse however many times it is called', async () => {
    const read = reader({ 'items.json': ITEMS });
    const data = createData({ fqid: FQID, declared: ['items.json'], read });

    const [first, second] = await Promise.all([data('items.json'), data('items.json')]);
    await data('items.json');

    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  // Documented behaviour, pinned so a later change to deep-freeze or to re-parse
  // per call is a deliberate one rather than a surprise to an addon holding it.
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
  // Almost always a typo or a file added to the directory and not to the
  // manifest, and both read as "it works on my machine" without the list.
  it('rejects an undeclared name and says what is declared', async () => {
    const read = reader({ 'items.json': ITEMS });
    const data = createData({ fqid: FQID, declared: ['items.json'], read });

    await expect(data('zones.json')).rejects.toThrow(/Declared: items\.json/);
    expect(read).not.toHaveBeenCalled();
  });

  // The argument is checked for membership, never joined onto a URL, and this is
  // the assertion that says so from the outside.
  it('rejects a traversing name like any other undeclared one', async () => {
    const data = createData({ fqid: FQID, declared: ['items.json'], read: reader({}) });

    await expect(data('../../secrets.json')).rejects.toThrow(/is not declared/);
  });

  it('says so plainly when the addon declared nothing at all', async () => {
    const data = createData({ fqid: FQID, declared: undefined, read: reader({}) });

    await expect(data('items.json')).rejects.toThrow(/Declared: nothing/);
  });

  // A rejection is the ONE thing an addon may be handed synchronously by
  // mistake: Comlink turns a throw into a rejection, so a surface that threw
  // here would be two different APIs depending on where it was called from.
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
  // The reasons this rejects that are worth retrying are not the addon's doing,
  // so a memoised rejection would outlive the condition that caused it.
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

  // An addon handed a bland failure would go looking at its own file. The
  // message has to say the loader never reached its host.
  it('carries the loader-not-connected message through from the reader', async () => {
    const data = createData({
      fqid: FQID,
      declared: ['items.json'],
      read: () => Promise.reject(new Error(`${FQID}: woc.data is unavailable, the loader never`)),
    });

    await expect(data('items.json')).rejects.toThrow(/woc\.data is unavailable/);
  });
});
