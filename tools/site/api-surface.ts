// The published API surface, read out of packages/types, so the docs can be held
// to it.
//
// Scoped to the `*Api` interfaces on purpose. The obvious reading of "every
// exported member is documented" also catches every field on every data shape,
// which means `agi`, `spi`, `armor` and ninety others: a guard that fires ninety
// times on the day it lands is a guard somebody deletes in the first week.
//
// The line that makes it useful is between what an author has to be TOLD exists
// and what they find once they are there. `woc.ui.toast()` is the first kind and
// belongs in prose. `entity.spi` is the second, and autocomplete is its
// documentation.
//
// Matching is on the QUALIFIED name (`net.onEvent`, not `onEvent`) because bare
// member names collide with ordinary prose. `api` matched the word "API" and
// `set`, `on` and `get` match almost any page, so the bare form reports success
// for members nobody wrote about.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './root.ts';

const TYPES_DIR = ['packages', 'types'];
const DECLARATION = /\.d\.ts$/;
const API_INTERFACE = /export interface (\w+Api)\s*\{/g;
const MEMBER = /^ {2}(?:readonly\s+)?([a-z][A-Za-z0-9]*)\??[(:<]/;
const API_SUFFIX = /Api$/;

/** The root interface. Everything else hangs off a member of it. */
const ROOT_API = 'WocApi';

function bodyOf(source: string, from: number): string {
  let depth = 1;
  let index = from;
  while (depth > 0 && index < source.length) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;
    }
    index += 1;
  }
  return source.slice(from, index - 1);
}

/** How far one line moves the nesting level, counting braces and parentheses. */
function depthDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === '{' || char === '(') {
      delta += 1;
    } else if (char === '}' || char === ')') {
      delta -= 1;
    }
  }
  return delta;
}

/** Top-level members only: a nested object literal's fields are not the surface. */
function membersOf(body: string): string[] {
  const found: string[] = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    const name = depth === 0 && MEMBER.exec(line)?.[1];
    if (name) {
      found.push(name);
    }
    depth += depthDelta(line);
  }
  return [...new Set(found)];
}

/** `NetApi` is reached as `woc.net`; the root itself is just `woc`. */
function prefixFor(interfaceName: string): string {
  if (interfaceName === ROOT_API) {
    return 'woc';
  }
  const stem = interfaceName.replace(API_SUFFIX, '');
  return stem.charAt(0).toLowerCase() + stem.slice(1);
}

/**
 * Members that are deliberately not written about, and why.
 *
 * An explicit list rather than a silent skip: "we decided not to document this"
 * is a decision worth recording, and this is the record. Anything not here has to
 * appear in the docs or the suite fails.
 */
export const EXEMPT: Record<string, string> = {
  'woc.clearTimeout':
    'the pair of woc.setTimeout, which is documented; naming it separately teaches nobody anything they did not already assume.',
  'woc.clearInterval': 'same, for woc.setInterval.',
  'woc.cancelAnimationFrame': 'same, for woc.requestAnimationFrame.',
  'woc.api': 'the API version number, which the manifest page covers as `apiVersion`.',
  'woc.now':
    'a monotonic clock. It behaves exactly as performance.now does and has no addon-specific behaviour to explain.',
  'woc.log':
    'console logging, prefixed with the addon id so a message can be traced back to its addon. The three levels are one idea and behave as console does.',
  'woc.warn':
    'the warn level of woc.log, with no behaviour of its own beyond the console method it forwards to.',
  'woc.error':
    'the error level of woc.log, with no behaviour of its own beyond the console method it forwards to.',
  'world.raw':
    'the escape hatch onto the untyped game object, deliberately undocumented: an addon that needs it is outside what this project supports, and advertising it would invite reads the shape check cannot cover.',
};

/** Every callable member of every `*Api` interface, as a qualified name. */
export function apiSurface(root: string = ROOT): ApiMember[] {
  const dir = join(root, ...TYPES_DIR);
  const found: ApiMember[] = [];
  for (const file of readdirSync(dir).filter((name) => DECLARATION.test(name))) {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const match of source.matchAll(API_INTERFACE)) {
      const owner = match[1] ?? '';
      const prefix = prefixFor(owner);
      for (const member of membersOf(bodyOf(source, match.index + match[0].length))) {
        found.push({ owner, prefix, member, qualified: `${prefix}.${member}` });
      }
    }
  }
  return found.sort((a, b) => a.qualified.localeCompare(b.qualified));
}

/** One member of the published surface. */
export interface ApiMember {
  /** The interface it is declared on, e.g. `NetApi`. */
  readonly owner: string;
  /** How it is reached, e.g. `net`. */
  readonly prefix: string;
  readonly member: string;
  /** What the docs have to contain, e.g. `net.onEvent`. */
  readonly qualified: string;
}
