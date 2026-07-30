// Named regions, so a docs example is a real file rather than a copy of one.
//
// Line ranges were the obvious design and are the wrong one: a range rots on
// every edit ABOVE it, and the failure is silent, because the build still
// succeeds while pointing at whatever moved into those lines. A named region
// survives edits anywhere else in the file, and a region that no longer exists is
// a hard failure naming the marker.
//
// The markers are `// #region <name>` and `// #endregion`, which are the ones VS
// Code already folds on, so a file carrying them is not carrying anything foreign.

const START = /^\s*\/\/\s*#region\s+([a-z0-9-]+)\s*$/;
const END = /^\s*\/\/\s*#endregion\b.*$/;
const NEWLINE = /\r?\n/;
const BLANK = /^\s*$/;

function isMarker(line: string): boolean {
  return START.test(line) || END.test(line);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The indentation of the least-indented non-blank line, or zero if there is none. */
function commonIndent(lines: readonly string[]): number {
  return lines
    .filter((line) => !BLANK.test(line))
    .reduce((least, line) => Math.min(least, indentOf(line)), Number.MAX_SAFE_INTEGER);
}

/**
 * The half-open line range a region's body occupies.
 *
 * Depth-counted rather than matched on the first `#endregion`, so a region that
 * encloses another one returns its own close instead of the inner one's.
 */
function bodyBounds(lines: readonly string[], name: string, at: string): [number, number] {
  const opened = lines.findIndex((line) => START.exec(line)?.[1] === name);
  if (opened < 0) {
    throw new Error(`${at}: no region \`${name}\`, expected a \`// #region ${name}\` marker`);
  }
  let depth = 1;
  for (let index = opened + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (START.test(line)) {
      depth += 1;
    } else if (END.test(line)) {
      depth -= 1;
      if (depth === 0) {
        return [opened + 1, index];
      }
    }
  }
  throw new Error(`${at}: region \`${name}\` is opened but never closed`);
}

function trimBlankEdges(lines: readonly string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && BLANK.test(out[0] ?? '')) {
    out.shift();
  }
  while (out.length > 0 && BLANK.test(out.at(-1) ?? '')) {
    out.pop();
  }
  return out;
}

/**
 * Pull one named region out of a source file, dedented and without its markers.
 *
 * Throws when the region is absent, which is the point: a docs page referring to
 * code that has moved fails the build rather than rendering an empty block.
 */
export function extractRegion(source: string, name: string, at: string): string {
  const lines = source.split(NEWLINE);
  const [from, to] = bodyBounds(lines, name, at);
  // A nested region's own markers are scaffolding for an editor, never content.
  const body = lines.slice(from, to).filter((line) => !isMarker(line));
  const indent = commonIndent(body);
  const dedented = trimBlankEdges(body.map((line) => line.slice(indent)));
  if (dedented.length === 0) {
    throw new Error(`${at}: region \`${name}\` is empty`);
  }
  return dedented.join('\n');
}

/** Every region name a file declares, in order, for the test that pins them. */
export function regionNames(source: string): string[] {
  return source
    .split(NEWLINE)
    .map((line) => START.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}
