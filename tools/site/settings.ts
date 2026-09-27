// One declared setting in a player's words ("on or off", "one of"), with the default spelled
// the way the control shows it. The manifest's own vocabulary belongs on the manifest page.

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

/** A boolean's default, in the words a checkbox has. */
function onOff(value: boolean): string {
  if (value) {
    return 'on';
  }
  return 'off';
}

/** A string default, with the empty one named rather than printed as `""`. */
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
 * One setting as a page prints it. `detail` is what constrains the value, null when nothing
 * does; an empty string there would render a stray separator.
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

/** `4 settings`, `1 setting`, `no settings`, shared by the card and the addon page. */
export function countOf(total: number, noun: string): string {
  if (total === 0) {
    return `no ${noun}s`;
  }
  if (total === 1) {
    return `1 ${noun}`;
  }
  return `${total} ${noun}s`;
}
