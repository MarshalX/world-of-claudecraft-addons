// Named regions (`// #region <name>` to `// #endregion`), so a docs example is a real file. Do not
// switch to line ranges: a range silently rots on every edit above it, while a missing region
// fails the build.

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

/** The half-open line range a region's body occupies, depth-counted so nested regions work. */
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

/** One named region of a source file, dedented and without its markers. Throws if absent. */
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
