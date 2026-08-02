import { describe, expect, it } from 'vitest';
import type { Context, Renderer } from '../tools/site/markdown.ts';
import { createRenderer } from '../tools/site/markdown.ts';
import type { Measured } from '../tools/site/shots.ts';

const SHOT: Measured = {
  id: 'combat-meter',
  file: 'combat-meter.png',
  stem: 'combat-meter',
  minWidth: 1000,
  caption: 'Bars tinted by damage school',
  alt: 'Combat Meter panel showing 17,602 damage in 11 seconds.',
  width: 810,
  height: 980,
  served: 810,
  portrait: true,
  maxWidth: 405,
  undersize: true,
};

// Stands in for shiki so the suite pins the pipeline rather than a theme.
function fakeHighlight(code: string, lang: string): string {
  return `<pre data-lang="${lang}">${code}</pre>`;
}

const context: Context = {
  shot(id) {
    if (id !== SHOT.id) {
      throw new Error(`unknown shot \`${id}\``);
    }
    return SHOT;
  },
  // Prose cannot reference an addon preview, so nothing in this suite reaches it.
  // It throws rather than returning a stand-in, since a rendering path that
  // started asking for one would be a change worth failing on.
  preview(id) {
    throw new Error(`prose asked for the preview of \`${id}\``);
  },
  include(path, region) {
    if (region === 'gone') {
      throw new Error('no region `gone`');
    }
    return `// from ${[path, region].filter(Boolean).join('#')}\nconst a = 1;`;
  },
};

const renderer: Renderer = createRenderer(fakeHighlight);

describe('prose', () => {
  it('renders ordinary Markdown', () => {
    expect(renderer.render('A **bold** claim.', context).html).toContain('<strong>bold</strong>');
  });

  // html: false is the decision being pinned here: the two things a page needs
  // beyond Markdown have their own syntax, so raw HTML is a mistake.
  it('escapes raw HTML rather than passing it through', () => {
    const out = renderer.render('<script>alert(1)</script>', context).html;
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('headings', () => {
  it('gives h2 and h3 an id and collects them in order', () => {
    const out = renderer.render('## The manifest\n\n### Fields\n', context);
    expect(out.html).toContain('<h2 id="the-manifest">');
    expect(out.headings).toEqual([
      { id: 'the-manifest', text: 'The manifest', level: 2 },
      { id: 'fields', text: 'Fields', level: 3 },
    ]);
  });

  it('does not collect h1, which is the page title', () => {
    expect(renderer.render('# Title\n\n## Section\n', context).headings).toHaveLength(1);
  });

  it('does not leak headings between renders', () => {
    renderer.render('## One\n', context);
    expect(renderer.render('## Two\n', context).headings).toEqual([
      { id: 'two', text: 'Two', level: 2 },
    ]);
  });
});

describe('shot references', () => {
  it('renders a lone shot reference as a block-level figure, not inside a paragraph', () => {
    const out = renderer.render('![](shot:combat-meter)', context).html;
    expect(out).toMatch(/<figure[ >]/);
    expect(out).not.toMatch(/<p>\s*<figure/);
  });

  it('takes alt and caption from the manifest, never from the page', () => {
    const out = renderer.render('![](shot:combat-meter)', context).html;
    expect(out).toContain(SHOT.alt);
    expect(out).toContain(SHOT.caption);
  });

  it('caps the plate at natural size so an undersized shot is never upscaled', () => {
    expect(renderer.render('![](shot:combat-meter)', context).html).toContain('max-width:405px');
  });

  it('renders surrounding prose normally', () => {
    const out = renderer.render('Before.\n\n![](shot:combat-meter)\n\nAfter.', context).html;
    expect(out).toContain('<p>Before.</p>');
    expect(out).toContain('<p>After.</p>');
  });

  it('renders two figures in one page', () => {
    const source = '![](shot:combat-meter)\n\n![](shot:combat-meter)';
    expect(renderer.render(source, context).html.match(/<figure[ >]/g)).toHaveLength(2);
  });

  // A renamed shot must fail the build rather than render a hole.
  it('throws on an unknown id', () => {
    expect(() => renderer.render('![](shot:nope)', context)).toThrow(/unknown shot `nope`/);
  });

  it('leaves an ordinary image reference alone', () => {
    expect(renderer.render('![a](/x.png)', context).html).toContain('<img');
  });
});

describe('code includes', () => {
  it('replaces an include comment with the real file contents', () => {
    const out = renderer.render('<!-- include: addons/cooldown-bars/main.js#frame -->', context);
    expect(out.html).toContain('const a = 1;');
    expect(out.html).toContain('#frame');
  });

  it('names the source file in the block header', () => {
    const out = renderer.render('<!-- include: addons/cooldown-bars/main.js -->', context);
    expect(out.html).toContain('addons/cooldown-bars/main.js');
  });

  it('infers the language from the extension', () => {
    const out = renderer.render('<!-- include: a/b.json -->', context);
    expect(out.html).toContain('data-lang="json"');
  });

  it('propagates a missing region as a build failure', () => {
    expect(() => renderer.render('<!-- include: a/b.js#gone -->', context)).toThrow(/no region/);
  });
});

describe('fenced code', () => {
  it('wraps a fence in the code block shell', () => {
    expect(renderer.render('```js\nconst a = 1;\n```', context).html).toContain('class="code"');
  });

  it('shows a filename given after the language', () => {
    const out = renderer.render('```json addon.json\n{}\n```', context).html;
    expect(out).toContain('addon.json');
  });

  it('omits the header when a fence has no filename', () => {
    expect(renderer.render('```js\nx\n```', context).html).not.toContain('code-head');
  });
});
