import { describe, expect, it, vi } from 'vitest';

import { createGmAdapter, detectCapabilities } from '../loader/src/host/gm.ts';
import {
  fakeChannelCtor,
  fullSource,
  greasemonkeySource,
  legacyOnlySource,
  noop,
  tampermonkeySource,
  violentmonkeySource,
} from './fakes/gm.ts';

const byName = (a: string, b: string): number => a.localeCompare(b);
const NO_STORE_MESSAGE = /no GM value store/;

describe('detectCapabilities', () => {
  it('prefers the promise API when both are present', () => {
    expect(detectCapabilities(fullSource())).toEqual({
      valueStore: 'gm4',
      valueChange: 'native',
      menuCommand: true,
    });
  });

  it('falls back to the legacy names when GM.* is absent', () => {
    const caps = detectCapabilities(legacyOnlySource());
    expect(caps.valueStore).toBe('legacy');
    expect(caps.valueChange).toBe('native');
  });

  it('selects the broadcast fallback when no listener API exists', () => {
    const caps = detectCapabilities(greasemonkeySource({ broadcastChannel: fakeChannelCtor }));
    expect(caps.valueStore).toBe('gm4');
    expect(caps.valueChange).toBe('broadcast');
  });

  it('reports no value-change support when neither exists', () => {
    expect(detectCapabilities(greasemonkeySource()).valueChange).toBe('none');
  });

  it('reports an absent value store rather than guessing', () => {
    expect(detectCapabilities({}).valueStore).toBe('none');
  });

  it('does not claim a store when only half the legacy pair is granted', () => {
    expect(detectCapabilities({ legacyGetValue: () => undefined }).valueStore).toBe('none');
  });

  it('reports menu commands from either surface', () => {
    expect(detectCapabilities(greasemonkeySource()).menuCommand).toBe(true);
    expect(detectCapabilities({ ...legacyOnlySource() }).menuCommand).toBe(false);
  });

  // Pinned against Violentmonkey 2.45 as observed, not as assumed: its GM object
  // stops at registerMenuCommand, so the promise store pairs with the legacy
  // listener. This mix is what the loader runs on in production.
  it('pairs the promise store with the legacy listener on Violentmonkey', () => {
    expect(detectCapabilities(violentmonkeySource())).toEqual({
      valueStore: 'gm4',
      valueChange: 'native',
      menuCommand: true,
    });
  });
});

describe('createGmAdapter', () => {
  it('refuses to construct without a value store', () => {
    expect(() => createGmAdapter({})).toThrow(NO_STORE_MESSAGE);
  });

  it.each([
    ['promise API', fullSource],
    ['legacy names', legacyOnlySource],
    ['greasemonkey', greasemonkeySource],
  ])('round-trips a value through the %s', async (_label, make) => {
    const gm = createGmAdapter(make());
    await gm.setValue('k', { a: 1 });
    expect(await gm.getValue('k', null)).toEqual({ a: 1 });
  });

  it('returns the fallback for a missing key', async () => {
    const gm = createGmAdapter(fullSource());
    expect(await gm.getValue('absent', 'fb')).toBe('fb');
  });

  it('treats a stored undefined as missing', async () => {
    const gm = createGmAdapter(fullSource());
    await gm.setValue('k', undefined);
    expect(await gm.getValue('k', 'fb')).toBe('fb');
  });

  it('deletes and lists', async () => {
    const gm = createGmAdapter(fullSource());
    await gm.setValue('a', 1);
    await gm.setValue('b', 2);
    expect((await gm.listValues()).sort(byName)).toEqual(['a', 'b']);
    await gm.deleteValue('a');
    expect((await gm.listValues()).sort(byName)).toEqual(['b']);
  });

  it('lists nothing when the manager does not grant listValues', async () => {
    const gm = createGmAdapter(greasemonkeySource({ gm: { ...greasemonkeySource().gm } }));
    expect(Array.isArray(await gm.listValues())).toBe(true);
  });

  it('uses the native listener and unsubscribes through it', () => {
    const src = fullSource();
    const remove = vi.fn();
    src.gm = { ...src.gm, removeValueChangeListener: remove };
    const gm = createGmAdapter(src);

    const off = gm.onValueChange('k', noop);
    off();
    expect(remove).toHaveBeenCalledOnce();
  });

  // Pinned against Tampermonkey 5.5 as observed. Both managers report a native
  // listener, but they reach it through different surfaces, so the capability
  // value alone cannot tell them apart.
  describe('on Tampermonkey', () => {
    it('detects the same capabilities as Violentmonkey', () => {
      expect(detectCapabilities(tampermonkeySource())).toEqual({
        valueStore: 'gm4',
        valueChange: 'native',
        menuCommand: true,
      });
    });

    it('subscribes through the GM object rather than the legacy name', () => {
      const src = tampermonkeySource();
      const viaGm = vi.fn(src.gm?.addValueChangeListener);
      const viaLegacy = vi.fn(src.legacyAddValueChangeListener);
      src.gm = { ...src.gm, addValueChangeListener: viaGm };
      src.legacyAddValueChangeListener = viaLegacy;

      createGmAdapter(src).onValueChange('k', noop);

      expect(viaGm).toHaveBeenCalledOnce();
      expect(viaLegacy).not.toHaveBeenCalled();
    });

    // The id arrives as a promise here, so unsubscribing has to await it. This
    // branch runs on no other manager.
    it('unsubscribes through the id the promise resolves to', async () => {
      const src = tampermonkeySource();
      const remove = vi.fn(src.gm?.removeValueChangeListener);
      src.gm = { ...src.gm, removeValueChangeListener: remove };
      const gm = createGmAdapter(src);
      const seen = vi.fn();

      gm.onValueChange('k', seen)();
      await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
      src.emit('k', 'fromAnotherTab');

      expect(remove).toHaveBeenCalledExactlyOnceWith(1);
      expect(seen).not.toHaveBeenCalled();
    });

    it('passes the echo of a local write through with remote false', async () => {
      const src = tampermonkeySource();
      const gm = createGmAdapter(src);
      const seen = vi.fn();

      gm.onValueChange('k', seen);
      await gm.setValue('k', 'mine');

      expect(seen).toHaveBeenCalledExactlyOnceWith({
        key: 'k',
        oldValue: undefined,
        newValue: 'mine',
        remote: false,
      });
    });
  });

  // The mixed Violentmonkey path routes reads through GM.* and change
  // notification through GM_addValueChangeListener. Nothing else covers a store
  // and a listener coming from different surfaces of the same manager.
  describe('on Violentmonkey', () => {
    it('round-trips a value through the promise store', async () => {
      const gm = createGmAdapter(violentmonkeySource());

      await gm.setValue('k', { a: 1 });

      expect(await gm.getValue('k', null)).toEqual({ a: 1 });
    });

    it('delivers a remote change through the legacy listener', () => {
      const src = violentmonkeySource();
      const gm = createGmAdapter(src);
      const seen = vi.fn();

      gm.onValueChange('k', seen);
      src.emit('k', 'fromAnotherTab');

      expect(seen).toHaveBeenCalledExactlyOnceWith({
        key: 'k',
        oldValue: undefined,
        newValue: 'fromAnotherTab',
        remote: true,
      });
    });

    // A BroadcastChannel exists here too, so only the detected capability keeps
    // the adapter off the fallback. Asserting the remover ran is what makes this
    // about path selection: the fallback also stops delivery, so an unobserved
    // handler would pass either way.
    it('unsubscribes through the legacy remover rather than the fallback', () => {
      const src = violentmonkeySource();
      const remove = vi.fn(src.legacyRemoveValueChangeListener);
      src.legacyRemoveValueChangeListener = remove;
      const gm = createGmAdapter(src);
      const seen = vi.fn();

      gm.onValueChange('k', seen)();
      src.emit('k', 'fromAnotherTab');

      expect(remove).toHaveBeenCalledOnce();
      expect(seen).not.toHaveBeenCalled();
    });
  });

  it('registers a menu command through whichever surface exists', () => {
    const register = vi.fn();
    const gm = createGmAdapter(greasemonkeySource({ legacyRegisterMenuCommand: register }));
    gm.registerMenuCommand('Addons', noop);
    // GM.registerMenuCommand is preferred, so the legacy spy stays untouched.
    expect(register).not.toHaveBeenCalled();

    const legacy = createGmAdapter({ ...legacyOnlySource(), legacyRegisterMenuCommand: register });
    legacy.registerMenuCommand('Addons', noop);
    expect(register).toHaveBeenCalledOnce();
  });
});
