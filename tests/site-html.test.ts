import { describe, expect, it } from 'vitest';
import { escapeHtml, html, join, raw, render } from '../tools/site/html.ts';

describe('escapeHtml', () => {
  it('escapes the five characters that can change markup', () => {
    expect(escapeHtml(`<a href="x" data-y='z'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; data-y=&#39;z&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves ordinary prose untouched', () => {
    expect(escapeHtml('A row per ability, with crit rate.')).toBe(
      'A row per ability, with crit rate.',
    );
  });
});

describe('html', () => {
  it('escapes an interpolated string', () => {
    expect(render(html`<p>${'<script>alert(1)</script>'}</p>`)).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  // The whole point of the tag: an addon description out of a third-party
  // marketplace index reaches a template as a plain string, and cannot inject.
  it('escapes a marketplace-supplied description', () => {
    const description = '"><img src=x onerror=alert(1)>';
    expect(render(html`<p>${description}</p>`)).not.toContain('<img');
  });

  it('does not double-escape nested markup', () => {
    const inner = html`<em>${'a & b'}</em>`;
    expect(render(html`<p>${inner}</p>`)).toBe('<p><em>a &amp; b</em></p>');
  });

  it('renders an array by concatenating its parts', () => {
    const rows = ['a', 'b'].map((c) => html`<li>${c}</li>`);
    expect(render(html`<ul>${rows}</ul>`)).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('escapes plain strings inside an interpolated array', () => {
    expect(render(html`<p>${['<b>', '&']}</p>`)).toBe('<p>&lt;b&gt;&amp;</p>');
  });

  // An unset optional field is the common case, and printing "undefined" into a
  // page is never what a template meant.
  it('renders null, undefined and false as nothing', () => {
    expect(render(html`<p>${null}${undefined}${false}</p>`)).toBe('<p></p>');
  });

  it('renders zero, because a zero count is a real value', () => {
    expect(render(html`<p>${0}</p>`)).toBe('<p>0</p>');
  });

  it('handles a template with no interpolations', () => {
    expect(render(html`<hr />`)).toBe('<hr />');
  });

  it('handles a value in the final position', () => {
    expect(render(html`<p>${'x'}`)).toBe('<p>x');
  });
});

describe('raw', () => {
  it('passes markup through unescaped', () => {
    expect(render(html`<div>${raw('<p>trusted</p>')}</div>`)).toBe('<div><p>trusted</p></div>');
  });
});

describe('join', () => {
  it('escapes plain parts and keeps a separator between them', () => {
    expect(render(join(['a&b', 'c'], ', '))).toBe('a&amp;b, c');
  });

  it('defaults to no separator', () => {
    expect(render(join(['a', 'b']))).toBe('ab');
  });
});
