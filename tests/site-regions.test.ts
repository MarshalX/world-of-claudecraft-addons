import { describe, expect, it } from 'vitest';
import { extractRegion, regionNames } from '../tools/site/regions.ts';

const AT = 'addons/cooldown-bars/main.js';

const SOURCE = [
  "const win = woc.ui.frame({ id: 'main' });",
  '',
  '// #region frame',
  "const bar = woc.ui.bar({ label: 'Aimed Shot' });",
  'frame.body.appendChild(bar.el);',
  '// #endregion',
  '',
  'woc.onDispose(() => bar.remove());',
].join('\n');

describe('extractRegion', () => {
  it('returns the region body without its markers', () => {
    expect(extractRegion(SOURCE, 'frame', AT)).toBe(
      "const bar = woc.ui.bar({ label: 'Aimed Shot' });\nframe.body.appendChild(bar.el);",
    );
  });

  it('leaves code outside the region out', () => {
    expect(extractRegion(SOURCE, 'frame', AT)).not.toContain('onDispose');
  });

  it('dedents to the shallowest line, so an indented region reads flush', () => {
    const nested = ['  // #region inner', '  if (a) {', '    b();', '  }', '  // #endregion'].join(
      '\n',
    );
    expect(extractRegion(nested, 'inner', AT)).toBe('if (a) {\n  b();\n}');
  });

  it('keeps relative indentation inside the region', () => {
    const src = ['// #region r', 'a();', '  b();', '// #endregion'].join('\n');
    expect(extractRegion(src, 'r', AT)).toBe('a();\n  b();');
  });

  it('preserves blank lines inside the region but trims the edges', () => {
    const src = ['// #region r', '', 'a();', '', 'b();', '', '// #endregion'].join('\n');
    expect(extractRegion(src, 'r', AT)).toBe('a();\n\nb();');
  });

  it('picks the named region when a file has several', () => {
    const src = [
      '// #region one',
      'first();',
      '// #endregion',
      '// #region two',
      'second();',
      '// #endregion',
    ].join('\n');
    expect(extractRegion(src, 'two', AT)).toBe('second();');
  });

  it('handles CRLF', () => {
    expect(extractRegion(SOURCE.replaceAll('\n', '\r\n'), 'frame', AT)).toContain('woc.ui.bar');
  });

  // The whole reason for named regions over line ranges: this fails loudly rather
  // than silently rendering whatever moved into those lines.
  it('throws when the region has been renamed or removed', () => {
    expect(() => extractRegion(SOURCE, 'gone', AT)).toThrow(/no region `gone`/);
  });

  it('names the file in the error', () => {
    expect(() => extractRegion(SOURCE, 'gone', AT)).toThrow(/cooldown-bars/);
  });

  it('throws on an unclosed region', () => {
    expect(() => extractRegion('// #region r\na();', 'r', AT)).toThrow(/never closed/);
  });

  it('throws on an empty region rather than rendering a blank block', () => {
    expect(() => extractRegion('// #region r\n\n// #endregion', 'r', AT)).toThrow(/is empty/);
  });
});

describe('regionNames', () => {
  it('lists every region a file declares, in order', () => {
    const src = ['// #region b', 'x();', '// #endregion', '// #region a', 'y();', '// #endregion'];
    expect(regionNames(src.join('\n'))).toEqual(['b', 'a']);
  });

  it('is empty for a file with no regions', () => {
    expect(regionNames('const a = 1;\n')).toEqual([]);
  });
});
