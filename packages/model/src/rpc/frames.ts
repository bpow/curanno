/**
 * The frames of a page as the sidebar sees them (ADR 0024). The sidebar
 * cannot be found from other frames: it sits in a closed shadow root, and
 * browsers leave such frames out of `window.frames`. It can reach every
 * other frame of the page through `window.top`, whose `length` and indexed
 * children are readable across origins, and announces itself to them.
 */

/** The parts of a possibly cross-origin `WindowProxy` that this uses. */
export interface FrameWindow {
  readonly length: number;
  readonly [index: number]: FrameWindow | undefined;
  readonly top: unknown;
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Every frame below `top`, depth first, not `top` itself. */
export function* framesBelow(top: FrameWindow): Generator<FrameWindow> {
  let length: number;
  try {
    length = top.length;
  } catch {
    return;
  }
  for (let i = 0; i < length; i++) {
    let frame: FrameWindow | undefined;
    try {
      frame = top[i];
    } catch {
      continue;
    }
    if (!frame) continue;
    yield frame;
    yield* framesBelow(frame);
  }
}

/** Whether `source` is a window of the page whose top window is `top`: not a popup or an opener. */
export function isFrameOf(source: unknown, top: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false;
  try {
    return (source as { top: unknown }).top === top;
  } catch {
    return false;
  }
}
