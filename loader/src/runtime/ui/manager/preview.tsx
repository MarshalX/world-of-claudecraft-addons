// An addon's screenshot, in the two sizes the manager shows it at. Resolving the shot is in
// catalog.ts; this file draws it.
//
// A plain cross-origin <img>, which works only because the game sets no Content-Security-Policy.
// A failed load takes the slot away. If a policy lands, fetch it in the host instead, where
// `raw.githubusercontent.com` is already in the connect list.

import { useState } from 'preact/hooks';
import type { AddonShot } from './catalog.ts';

/**
 * The box each size reserves, in CSS pixels. Set on the element so the row does not jump when the
 * image arrives; must agree with the stylesheet's box.
 */
const BOX = {
  thumb: { width: 96, height: 54 },
  full: { width: 420, height: 200 },
} as const;

interface PreviewProps {
  /** Null for an addon with no screenshot, and for one whose source is gone. */
  shot: AddonShot | null;
  /** `thumb` sits in a list row; `full` sits on the install confirmation. */
  size: 'thumb' | 'full';
  /** Reserve the slot when this row has no screenshot, so rows line up when others have one. */
  placeholder?: boolean;
}

/** Draws nothing for an addon with no screenshot, which is the ordinary case. */
export function Preview(props: PreviewProps) {
  const [failed, setFailed] = useState(false);
  const { shot } = props;
  if (shot === null || failed) {
    if (props.size === 'thumb' && props.placeholder === true) {
      return <div className="woc-shot-slot" />;
    }
    return null;
  }
  return (
    // biome-ignore lint/performance/noImgElement: the rule wants a framework's Image component, and the manager is plain preact injected into a page the loader does not own. There is nothing to defer to.
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError is not an interaction. It is the load-failure path, and taking the slot away is exactly what an image nobody can fetch should do.
    <img
      className={`woc-shot woc-shot-${props.size}`}
      src={shot.url}
      alt={shot.alt}
      width={BOX[props.size].width}
      height={BOX[props.size].height}
      // Only rows scrolled into view cost a request.
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
