// Long-press drag to reorder the HOY rows (touch and mouse). A short tap still edits and a quick swipe still scrolls:
// the drag only starts after the finger rests HOLD_MS without moving more than SLOP_PX.
export const HOLD_MS = 450;
export const SLOP_PX = 10;

/**
 * Final row index for a row dragged from `from` and released at `y`, given each row's vertical midpoint (in list
 * order, the dragged row included). Pure, so it is unit-tested.
 */
export function dropIndex(midpoints, from, y) {
  const above = midpoints.filter((mid, i) => i !== from && mid < y).length;
  return Math.max(0, Math.min(midpoints.length - 1, above));
}

/**
 * Makes the `rowSelector` children of `list` reorderable by long-press drag. `canStart(row)` can veto (e.g. while an
 * editor is open); `onDrop(fromIndex, toIndex)` is called once per finished drag that changed the position.
 */
export function enableLongPressReorder(list, { rowSelector, canStart = () => true, onDrop }) {
  let press = null;

  const rows = () => [...list.children];
  const reset = () => {
    if (press?.timer) clearTimeout(press.timer);
    if (press?.row) { press.row.classList.remove('dragging'); press.row.style.transform = ''; }
    list.classList.remove('reordering');
    press = null;
  };

  list.addEventListener('pointerdown', (e) => {
    const row = e.target.closest(rowSelector);
    if (!row || e.target.closest('button, select, input') || (e.pointerType === 'mouse' && e.button !== 0) || !canStart(row)) return;
    press = { id: e.pointerId, row: null, startY: e.clientY, startX: e.clientX, from: rows().indexOf(row), candidate: row, mids: [] };
    press.timer = setTimeout(() => startDrag(), HOLD_MS);
  });

  function startDrag() {
    if (!press) return;
    press.timer = null;
    press.row = press.candidate;
    press.mids = rows().map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
    press.row.classList.add('dragging');
    list.classList.add('reordering');
    navigator.vibrate?.(15);
  }

  list.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dy = e.clientY - press.startY;
    if (!press.row) {
      if (Math.abs(dy) > SLOP_PX || Math.abs(e.clientX - press.startX) > SLOP_PX) reset(); // a scroll, not a hold
      return;
    }
    press.row.style.transform = `translateY(${dy}px)`;
  });

  // While dragging, keep the page from scrolling under the finger (needs a non-passive listener).
  list.addEventListener('touchmove', (e) => { if (press?.row) e.preventDefault(); }, { passive: false });
  list.addEventListener('contextmenu', (e) => { if (press) e.preventDefault(); });

  list.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.row) { reset(); return; }
    const from = press.from;
    const to = dropIndex(press.mids, from, e.clientY);
    // The click that follows the release must not open the editor.
    list.addEventListener('click', (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
    reset();
    if (to !== from) onDrop(from, to);
  });
  list.addEventListener('pointercancel', reset);
}
