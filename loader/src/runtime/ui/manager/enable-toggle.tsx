// The enable switch, which two panes render identically.
//
// It is on the Installed row AND on the addon's own page. That is not
// redundancy: installing does not enable, so an addon reaches its own page
// reading STOPPED, and a page that shows that badge with no control to change it
// is a dead end. The control that answers the badge belongs next to the badge.
//
// What it reports is the player's INTENT, which is not the same as the run
// status beside it: an addon can be enabled and still not running because it
// failed to load or cannot run on this channel. See status.ts.

import { UI_TEXT } from './strings.ts';

function toggleLabel(enabled: boolean): string {
  if (enabled) {
    return UI_TEXT.enabled;
  }
  return UI_TEXT.disabled;
}

interface EnableToggleProps {
  enabled: boolean;
  onToggle: (on: boolean) => void;
  /** Names the addon for a screen reader, since the visible label is just a state. */
  label?: string;
}

export function EnableToggle(props: EnableToggleProps) {
  return (
    <label className="woc-toggle">
      <input
        type="checkbox"
        checked={props.enabled}
        aria-label={props.label}
        onChange={(event) => {
          props.onToggle((event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{toggleLabel(props.enabled)}</span>
    </label>
  );
}
