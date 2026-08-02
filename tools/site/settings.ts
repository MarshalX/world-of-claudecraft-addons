// One declared setting, said in words a player reads rather than in the words a
// manifest is written in.
//
// The manifest's own vocabulary is `boolean`, `number`, `string`, `select`, and
// that vocabulary belongs on the manifest reference page, which documents the
// schema for somebody writing one. An addon page is read by somebody deciding
// whether to install, so a row says "on or off" and "one of", and the DEFAULT is
// spelled the way the control will show it: a boolean's default is on or off, not
// `true`.
//
// Pure, and separate from the page that renders it, because every rule here is a
// small decision that is easy to get subtly wrong (an empty string default that
// prints as nothing at all, a number with a floor and no ceiling) and each one is
// worth a test. The page turns these into markup and decides nothing.

import type { SettingDecl } from '../../loader/src/shared/schema.ts';

/** How a number's bounds read, or null when it declares none. */
function bounds(min: number | undefined, max: number | undefined): string | null {
  if (min !== undefined && max !== undefined) {
    return `${min} to ${max}`;
  }
  if (min !== undefined) {
    return `at least ${min}`;
  }
  if (max !== undefined) {
    return `at most ${max}`;
  }
  return null;
}

/**
 * A boolean's default, in the words a checkbox has.
 *
 * `true` and `false` are what the file says and are not what the player sees:
 * the manager draws a checkbox, and a checkbox is on or off.
 */
function onOff(value: boolean): string {
  if (value) {
    return 'on';
  }
  return 'off';
}

/**
 * A string default, with the empty one named rather than printed.
 *
 * An empty default is common and legitimate (a keyword list nobody has filled
 * in), and printed as `""` beside "default" it reads as a bug in this page.
 */
function textDefault(value: string): string {
  if (value === '') {
    return 'empty';
  }
  return value;
}

function forSelect(setting: Extract<SettingDecl, { type: 'select' }>): SettingSummary {
  return {
    id: setting.id,
    label: setting.label,
    kind: 'one of',
    detail: setting.options.join(', '),
    fallback: setting.default,
  };
}

function summarize(setting: SettingDecl): SettingSummary {
  const head = { id: setting.id, label: setting.label };
  if (setting.type === 'boolean') {
    return { ...head, kind: 'on or off', detail: null, fallback: onOff(setting.default) };
  }
  if (setting.type === 'number') {
    return {
      ...head,
      kind: 'number',
      detail: bounds(setting.min, setting.max),
      fallback: String(setting.default),
    };
  }
  if (setting.type === 'select') {
    return forSelect(setting);
  }
  return { ...head, kind: 'text', detail: null, fallback: textDefault(setting.default) };
}

/**
 * One setting as a page prints it.
 *
 * `detail` is what CONSTRAINS the value and is null when nothing does, which is
 * the whole reason it is nullable: a number with no bounds and a number from 0 to
 * 100 are different things to a reader, and an empty string in that slot would
 * render as a stray separator.
 */
export interface SettingSummary {
  readonly id: string;
  readonly label: string;
  readonly kind: 'on or off' | 'number' | 'one of' | 'text';
  readonly detail: string | null;
  readonly fallback: string;
}

/** Summarise one declared setting for a reader. See SettingSummary. */
export function describeSetting(setting: SettingDecl): SettingSummary {
  return summarize(setting);
}

/**
 * `4 settings`, `1 setting`, `no settings`.
 *
 * Here rather than in the page because both the card and the addon page count the
 * same things, and because English plurals are exactly the kind of thing that
 * ends up written twice and disagreeing.
 */
export function countOf(total: number, noun: string): string {
  if (total === 0) {
    return `no ${noun}s`;
  }
  if (total === 1) {
    return `1 ${noun}`;
  }
  return `${total} ${noun}s`;
}
