/**
 * Touch gestures for a self-voicing app.
 *
 * The app announces everything itself rather than relying on TalkBack, which
 * means deliberately claiming the single-finger gestures a screen reader would
 * normally use. `docs/phone-demo-navigation.md` 1 warned against exactly this,
 * so it is a decision, not an accident: a self-voicing app owns its gestures,
 * but the two approaches cannot be mixed on the same surface.
 *
 * The rule that keeps the two modes from fighting:
 *
 *   menu mode   single-finger swipes move between items; tap activates
 *   graph mode  single-finger drag traces the curve; no swipes
 *   both        two-finger tap toggles the mode
 *
 * A two-finger tap is the toggle because it cannot be produced by accident
 * while tracing a line, and it is the convention screen-reader users already
 * know from elsewhere.
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

export type Gesture =
  | { type: 'swipe'; direction: SwipeDirection; distance: number }
  | { type: 'tap'; x: number; y: number }
  | { type: 'two-finger-tap' }
  | { type: 'long-press'; x: number; y: number }
  | { type: 'drag'; phase: 'start' | 'move' | 'end'; x: number; y: number };

export interface GestureOptions {
  /** Minimum travel for a swipe, in CSS pixels. */
  swipeMinDistance?: number;
  /** Beyond this, a fast movement is a drag rather than a swipe. */
  swipeMaxDuration?: number;
  /** Maximum travel still counted as a tap rather than a drag. */
  tapMaxDistance?: number;
  tapMaxDuration?: number;
  longPressDuration?: number;
  /** True while single-finger movement should trace instead of swipe. */
  isTracing: () => boolean;
}

const DEFAULTS = {
  swipeMinDistance: 48,
  swipeMaxDuration: 800,
  tapMaxDistance: 12,
  tapMaxDuration: 350,
  longPressDuration: 650,
};

interface TrackedPointer {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startedAt: number;
  moved: boolean;
}

/**
 * Feed it pointer events; it emits semantic gestures.
 *
 * Deliberately not a React hook and not bound to any element, so the same
 * recogniser works for the chart surface and the menu surface.
 */
export class GestureRecogniser {
  private readonly pointers = new Map<number, TrackedPointer>();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set once a second finger lands, so lifting either one cannot also tap. */
  private multiTouch = false;
  private multiTouchStartedAt = 0;

  private readonly opts: Required<Omit<GestureOptions, 'isTracing'>> & {
    isTracing: () => boolean;
  };

  constructor(
    private readonly onGesture: (gesture: Gesture) => void,
    options: GestureOptions,
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  pointerDown(event: { pointerId: number; clientX: number; clientY: number }): void {
    const now = Date.now();
    this.pointers.set(event.pointerId, {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startedAt: now,
      moved: false,
    });

    if (this.pointers.size === 2) {
      this.multiTouch = true;
      this.multiTouchStartedAt = now;
      this.cancelLongPress();
      return;
    }

    if (this.pointers.size === 1) {
      if (this.opts.isTracing()) {
        this.onGesture({ type: 'drag', phase: 'start', x: event.clientX, y: event.clientY });
      }
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        const p = this.pointers.get(event.pointerId);
        if (p && !p.moved && !this.multiTouch) {
          this.onGesture({ type: 'long-press', x: p.x, y: p.y });
        }
      }, this.opts.longPressDuration);
    }
  }

  pointerMove(event: { pointerId: number; clientX: number; clientY: number }): void {
    const p = this.pointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX;
    p.y = event.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > this.opts.tapMaxDistance) {
      p.moved = true;
      this.cancelLongPress();
    }

    // Tracing consumes single-finger movement entirely; a second finger is a
    // mode toggle in progress, so nothing should trace during it.
    if (this.pointers.size === 1 && this.opts.isTracing()) {
      this.onGesture({ type: 'drag', phase: 'move', x: p.x, y: p.y });
    }
  }

  pointerUp(event: { pointerId: number }): void {
    const p = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    if (!p) return;
    this.cancelLongPress();

    const duration = Date.now() - p.startedAt;
    const dx = p.x - p.startX;
    const dy = p.y - p.startY;
    const distance = Math.hypot(dx, dy);

    if (this.multiTouch) {
      // Fire once, when the last of the two fingers lifts.
      if (this.pointers.size === 0) {
        const held = Date.now() - this.multiTouchStartedAt;
        this.multiTouch = false;
        if (held <= this.opts.tapMaxDuration * 2 && distance <= this.opts.swipeMinDistance) {
          this.onGesture({ type: 'two-finger-tap' });
        }
      }
      return;
    }

    if (this.opts.isTracing()) {
      this.onGesture({ type: 'drag', phase: 'end', x: p.x, y: p.y });
      // A tap while tracing still counts, so the user can stop and act.
      if (distance <= this.opts.tapMaxDistance && duration <= this.opts.tapMaxDuration) {
        this.onGesture({ type: 'tap', x: p.x, y: p.y });
      }
      return;
    }

    if (distance >= this.opts.swipeMinDistance && duration <= this.opts.swipeMaxDuration) {
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const direction: SwipeDirection = horizontal
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');
      this.onGesture({ type: 'swipe', direction, distance });
      return;
    }

    if (distance <= this.opts.tapMaxDistance && duration <= this.opts.tapMaxDuration) {
      this.onGesture({ type: 'tap', x: p.x, y: p.y });
    }
  }

  pointerCancel(event: { pointerId: number }): void {
    this.pointers.delete(event.pointerId);
    this.cancelLongPress();
    if (this.pointers.size === 0) this.multiTouch = false;
  }

  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /** Drop all tracking, e.g. when the mode changes underneath. */
  reset(): void {
    this.pointers.clear();
    this.cancelLongPress();
    this.multiTouch = false;
  }
}
