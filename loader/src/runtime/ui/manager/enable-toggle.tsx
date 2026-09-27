// The enable switch, drawn identically on the Installed row and the addon's own page. It reports
// the player's INTENT: an enabled addon can still be not running (see status.ts).

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
