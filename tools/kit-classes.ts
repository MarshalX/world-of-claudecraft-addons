// Which GAME classes the loader's own elements wear, read from the kit source.
//
// `tools/theme-core.ts` must transcribe the rule for every such class, or a stage frame gets the
// game's tokens without the `.panel` rule and renders with no edge; nothing raises, so a test
// checks that list against this reading. TypeScript so a Vitest suite can import it, since
// `noNodejsModules` is not exempt under `tests/**`.
//
// The heuristic: every class list the loader writes names a `woc-` class, so any literal with
// one is a class list and its other names are game classes. It over-reports rather than misses.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './manifests.ts';

/** Where the loader builds its own DOM. Everything with a className is here. */
const UI_DIR = join(ROOT, 'loader/src/runtime/ui');

/** Whitespace between class names in one literal. */
const SPACES = /\s+/;

/** A single- or double-quoted string, or a template literal. */
const LITERAL = /'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g;

/** A `${...}` hole in a template literal, which names no class. */
const INTERPOLATION = /\$\{[^}]*\}/g;

/** A bare class name. Matched positively: the non-class strings here take unbounded shapes. */
const CLASS_NAME = /^[a-zA-Z][\w-]*$/;

/** Every `.ts` and `.tsx` under the UI tree, at any depth. */
function uiSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...uiSources(path));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(path);
    }
  }
  return found;
}

/** The class names in one literal, or none when it is not a class list. */
function classesIn(literal: string): string[] {
  const tokens = literal
    .replaceAll(INTERPOLATION, ' ')
    .split(SPACES)
    .filter((token) => token.length > 0);
  if (!tokens.some((token) => token.startsWith('woc-'))) {
    return [];
  }
  return tokens.filter((token) => !token.startsWith('woc-') && CLASS_NAME.test(token));
}

/** Every game class the loader wears, sorted. */
function gameClassesWorn(): string[] {
  const found = new Set<string>();
  for (const file of uiSources(UI_DIR)) {
    const source = readFileSync(file, 'utf8');
    for (const [, single, double, template] of source.matchAll(LITERAL)) {
      for (const name of classesIn(single ?? double ?? template ?? '')) {
        found.add(name);
      }
    }
  }
  return [...found].sort();
}

/**
 * The whole UI tree as one string. `pnpm theme` searches it for custom properties the kit sets
 * from JavaScript, which appear in no stylesheet and would otherwise read as dropped game tokens.
 */
function uiSourceText(): string {
  return uiSources(UI_DIR)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

export { gameClassesWorn, UI_DIR, uiSourceText };
