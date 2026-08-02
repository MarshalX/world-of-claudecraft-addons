// Which GAME classes the loader's own elements wear.
//
// It exists to stop one silent failure, which has already happened once. The kit
// puts `panel` on a frame so the frame inherits the game's border, background and
// shadow rather than keeping a copy. `tools/theme-core.ts` has to know that, or
// `pnpm theme` writes a stylesheet with the tokens and none of the rules, and a
// stage frame renders with no edge at all while every colour on it looks right.
// Nothing raises, nothing is missing, and the only way to notice is to look at a
// screenshot and know what a frame is supposed to look like. That is how it was
// found: reported from the stage as "why does the combat meter have no frame".
//
// So the list in theme-core is checked against the kit rather than trusted.
// TypeScript rather than .mjs for the reason manifests.ts is: a Vitest suite
// imports it and lets it do the reading, since `noNodejsModules` is not exempt
// under `tests/**`.
//
// The reading is a heuristic and is deliberately a LOUD one. Every class list the
// loader writes names at least one `woc-` class, so any literal containing one is
// read as a class list and everything else in it is a game class. A literal that
// breaks the assumption is over-reported rather than missed, which fails a test
// rather than shipping a stage that quietly does not match the game.

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

/**
 * A bare class name.
 *
 * Positive rather than a list of things to exclude, because the strings in this
 * tree that are not class lists are prose, selectors and punctuation, and there
 * is no end to the shapes those take. A name starts with a letter and carries
 * only word characters and hyphens; anything else in a literal is not a class,
 * whatever else it might be.
 */
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
  // A class list the loader writes always names at least one of its own, which is
  // what separates `'woc-close x-btn'` from every other string in the file.
  if (!tokens.some((token) => token.startsWith('woc-'))) {
    return [];
  }
  return tokens.filter((token) => !token.startsWith('woc-') && CLASS_NAME.test(token));
}

/**
 * Every game class the loader wears, sorted.
 *
 * Read fresh rather than cached: the callers are a test and a CLI, each of which
 * runs once.
 */
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

export { gameClassesWorn, UI_DIR };
