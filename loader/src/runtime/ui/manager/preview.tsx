// An addon's screenshot, in the two sizes the manager shows it at.
//
// It takes a resolved shot rather than the row it came from, because the three
// places a preview appears do not agree on what they are holding: Browse and the
// install confirmation have the marketplace row, and an Installed row has an
// fqid and has to look the picture up. Resolution lives in catalog.ts with the
// rest of the pure derivation; this file is the drawing.
//
// It is an ordinary cross-origin <img> from the page, not a fetch through the
// host. That works because the game sets no Content-Security-Policy, which its
// own source says is deferred rather than declined, so this is a thing that
// works today and could stop. Hence `failed`: a preview that cannot load takes
// its slot away instead of leaving a broken-image frame in a list, the same way
// `ui/kit/bar.ts` hides an icon slot whose art 404s. If a policy ever does land,
// the fallback is to fetch it in the host, where `raw.githubusercontent.com` is
// already in the userscript's connect list, and hand the bytes over as a blob.

import { useState } from 'preact/hooks';
import type { AddonShot } from './catalog.ts';

/**
 * The box each size reserves, in CSS pixels.
 *
 * On the element as `width` and `height` rather than left to the stylesheet
 * alone, because these load over the network while the player is reading the list
 * they sit in: without them the row is one height before the image arrives and
 * another after. The stylesheet fixes the same box, and the two have to agree;
 * `object-fit: contain` is what lets one box hold a tall panel and a wide one.
 */
const BOX = {
  thumb: { width: 96, height: 54 },
  full: { width: 420, height: 200 },
} as const;

interface PreviewProps {
  /** Null for an addon with no screenshot, and for one whose source is gone. */
  shot: AddonShot | null;
  /**
   * `thumb` sits in a browse row; `full` sits on the install confirmation.
   *
   * Two named sizes rather than a width, because these are the only two places a
   * preview appears and a caller passing pixels would be deciding something the
   * stylesheet is better placed to decide.
   */
  size: 'thumb' | 'full';
  /**
   * Reserve the slot when this row has no screenshot.
   *
   * Set for a browse row whenever ANYTHING on offer has one, so the rows line up
   * and an addon without a picture is visibly an addon without a picture rather
   * than a row that drew short. Left off when nothing has one, where a column of
   * empty frames would be decoration on a list that is simply text.
   */
  placeholder?: boolean;
}

/**
 * Draws nothing at all for an addon with no screenshot, which is the ordinary
 * case rather than a defect: publishing is not gated on someone taking a picture.
 */
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
      // Only the rows a player scrolls to cost a request, which is what makes a
      // thumbnail per row affordable in a list of thirty.
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
