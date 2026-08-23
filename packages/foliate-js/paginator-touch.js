export const hasActiveTextSelection = (contents) => {
  for (const { doc } of contents ?? []) {
    const selection = doc?.getSelection?.();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return true;
  }
  return false;
};

export class PaginatorTouchTracker {
  state;
  scrolled = false;

  start(touch, timeStamp, startPosition) {
    this.state = {
      x: touch?.screenX,
      y: touch?.screenY,
      t: timeStamp,
      vx: 0,
      xy: 0,
      dx: 0,
      dy: 0,
      dt: 0,
      startX: touch?.screenX,
      startY: touch?.screenY,
      startPosition,
      didPreventDefault: false,
    };
    this.scrolled = false;
    return this.state;
  }

  markScrolled() {
    this.scrolled = true;
  }

  cancel() {
    const restorePosition =
      this.scrolled && Number.isFinite(this.state?.startPosition) ? this.state.startPosition : null;
    this.state = undefined;
    this.scrolled = false;
    return restorePosition;
  }

  finish() {
    const state = this.scrolled ? (this.state ?? null) : null;
    this.state = undefined;
    this.scrolled = false;
    return state;
  }
}
