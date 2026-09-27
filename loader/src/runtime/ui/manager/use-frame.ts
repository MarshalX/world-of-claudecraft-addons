// Wiring the manager window to the shared frame primitive. The interact instance lives and dies
// with the mounted window; the caller holds the geometry, so a reopen comes back where it was.

import { useEffect, useRef } from 'preact/hooks';
import { clampBox, defaultBox, type FrameBox, type Viewport } from '../frame/geometry.ts';
import { makeFrameInteractive } from '../frame/interactive.ts';

function viewport(): Viewport {
  return { w: globalThis.innerWidth, h: globalThis.innerHeight };
}

function startingBox(box: FrameBox | null, view: Viewport): FrameBox {
  if (box === null) {
    return defaultBox(view);
  }
  return clampBox(box, view);
}

export interface UseFrameDeps {
  /** Null until the player has moved or resized the window. */
  box: FrameBox | null;
  onGeometry: (box: FrameBox) => void;
}

export interface FrameRefs {
  frame: { current: HTMLElement | null };
  handle: { current: HTMLElement | null };
}

export function useInteractiveFrame(deps: UseFrameDeps): FrameRefs {
  const frame = useRef<HTMLElement | null>(null);
  const handle = useRef<HTMLElement | null>(null);

  // Runs once per mount: re-running on a box change tears down interact mid-gesture.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above, this is a mount-scoped effect over refs and the box is an initial value rather than a reactive input
  useEffect(() => {
    const el = frame.current;
    const grip = handle.current;
    if (el === null || grip === null) {
      return;
    }

    const view = viewport();
    const interactive = makeFrameInteractive({
      el,
      handle: grip,
      viewport,
      box: startingBox(deps.box, view),
      onCommit: deps.onGeometry,
    });

    // Refit on resize, or a title bar left off screen can never be grabbed back.
    const onResize = (): void => {
      interactive.refit();
    };
    globalThis.addEventListener('resize', onResize);

    return () => {
      globalThis.removeEventListener('resize', onResize);
      interactive.destroy();
    };
  }, []);

  return { frame, handle };
}
