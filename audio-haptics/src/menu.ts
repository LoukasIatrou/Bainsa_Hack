/**
 * Spoken menu and the menu/graph mode toggle.
 *
 * Replaces on-screen buttons with a swipeable, self-voicing list: swipe left
 * and right to move between actions, each announced as it gains focus, tap to
 * activate. Nothing here needs to be seen.
 *
 * Every announcement is spoken at `interrupt` priority. Swiping quickly through
 * a list should track the finger, not queue a backlog of stale item names --
 * the same rule the point readouts follow.
 */

import type { HapticPatternName } from './types.js';

export type AppMode = 'menu' | 'graph';

export interface MenuItem {
  id: string;
  /** Spoken when the item gains focus. */
  label: string;
  /** Extra detail spoken after the label, when the item needs explaining. */
  hint?: string;
  /** Items that return false are skipped entirely, not read out as disabled. */
  available?: () => boolean;
  activate: () => void;
}

export interface MenuDeps {
  speak: (text: string, priority: 'interrupt' | 'normal') => void;
  pulse: (pattern: HapticPatternName) => void;
  onChange: () => void;
  /** Called when leaving graph mode, so tracing can be torn down. */
  onExitGraphMode?: () => void;
  /** Called when entering graph mode. */
  onEnterGraphMode?: () => void;
}

export class MenuController {
  private mode: AppMode = 'menu';
  private items: MenuItem[] = [];
  private index = 0;

  constructor(private readonly deps: MenuDeps) {}

  setItems(items: MenuItem[]): void {
    this.items = items;
    if (this.index >= this.visible.length) this.index = 0;
    this.deps.onChange();
  }

  /** Only the items currently available; unavailable ones are not read at all. */
  get visible(): MenuItem[] {
    return this.items.filter((i) => i.available === undefined || i.available());
  }

  get currentMode(): AppMode {
    return this.mode;
  }

  get current(): MenuItem | null {
    return this.visible[this.index] ?? null;
  }

  get position(): { index: number; total: number } {
    return { index: this.index, total: this.visible.length };
  }

  // -- mode -------------------------------------------------------------------

  toggleMode(): void {
    this.setMode(this.mode === 'menu' ? 'graph' : 'menu');
  }

  setMode(mode: AppMode): void {
    if (mode === this.mode) return;
    this.mode = mode;

    if (mode === 'graph') {
      this.deps.onEnterGraphMode?.();
      this.deps.pulse('long');
      this.deps.speak(
        'Graph mode. Drag a finger to follow the curve. Two-finger tap to return to the menu.',
        'interrupt',
      );
    } else {
      this.deps.onExitGraphMode?.();
      this.deps.pulse('long');
      this.deps.speak('Menu mode.', 'interrupt');
      this.announceCurrent({ includeHint: false });
    }
    this.deps.onChange();
  }

  // -- navigation -------------------------------------------------------------

  next(): void {
    this.move(1);
  }

  previous(): void {
    this.move(-1);
  }

  private move(delta: number): void {
    const items = this.visible;
    if (items.length === 0) {
      this.deps.speak('No actions are available yet.', 'interrupt');
      return;
    }

    const next = this.index + delta;
    if (next < 0 || next >= items.length) {
      // Stop at the ends rather than wrapping. Wrapping costs a blind user
      // their sense of where the list starts and stops.
      this.deps.pulse('long');
      this.deps.speak(next < 0 ? 'Start of menu.' : 'End of menu.', 'interrupt');
      return;
    }

    this.index = next;
    this.deps.pulse('short');
    this.announceCurrent();
    this.deps.onChange();
  }

  focus(id: string): void {
    const i = this.visible.findIndex((item) => item.id === id);
    if (i === -1) return;
    this.index = i;
    this.announceCurrent();
    this.deps.onChange();
  }

  /** Re-read the focused item without moving -- a "where am I" gesture. */
  announceCurrent(options: { includeHint?: boolean } = {}): void {
    const item = this.current;
    if (!item) {
      this.deps.speak('No actions are available yet.', 'interrupt');
      return;
    }
    const { index, total } = this.position;
    const hint = options.includeHint === false || !item.hint ? '' : ` ${item.hint}`;
    this.deps.speak(`${item.label}.${hint} ${index + 1} of ${total}.`, 'interrupt');
  }

  activate(): void {
    const item = this.current;
    if (!item) {
      this.deps.speak('No actions are available yet.', 'interrupt');
      return;
    }
    this.deps.pulse('double');
    item.activate();
    this.deps.onChange();
  }
}
