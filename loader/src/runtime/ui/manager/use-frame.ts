// Wiring the manager window to the shared frame primitive.
//
// The window unmounts on close, so the interact instance is set up and torn down
// with it and the geometry itself is held by the caller. That split is what lets
// a reopened window come back where the player left it.

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

  // Deliberately empty deps: the effect runs once per mount, and the geometry it
  // starts from is read at that moment. Re-running it on every box change would
  // tear down the interact instance mid-gesture.
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

    // A window left off the edge by a resized browser could never be grabbed
    // back, since the title bar is the handle.
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
