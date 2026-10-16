// Planner rules for the PWA, mirroring src/SoaringHigh5.Core/Planner.cs: five slots (one per category), one task
// per slot and day, TODO list grouped by category/urgency, day change carries pending tasks over. Pure functions on
// plain data (no DOM); sync stamps (updatedAt) are added by merge.stamp() from the diff, so edits here sync as usual.
// Moving a TODO item to today takes it OUT of the list (the task keeps the item's id; with all 5 busy the least
// important pending task goes back to TODO); deleting today's task auto-fills the slot with the most urgent open item
// of that category (done does not).
// tests/today-fixtures.json is checked by both the node and the C# tests (parity).
import { CATEGORY_COUNT, URGENCIES, normalizeSlotOrder } from './merge.js';

export const MAX_TEXT_LENGTH = 200;

export function localDay(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function emptyPlanner() {
  return { slotTasks: [], backlog: [], slotOrder: normalizeSlotOrder([]), lastRolloverDate: null };
}

export function cleanText(text) {
  const clean = (text ?? '').trim().replace(/\r?\n/g, ' ');
  if (!clean) return null;
  return clean.length > MAX_TEXT_LENGTH ? clean.slice(0, MAX_TEXT_LENGTH) : clean;
}

/** Current task of a slot on a day (the last one, like the desktop app). */
export function currentInSlot(p, slot, day) {
  const matches = p.slotTasks.filter((t) => t.date === day && t.slot === slot);
  return matches.length ? matches[matches.length - 1] : null;
}

export const isSlotFree = (p, slot, day) => {
  const t = currentInSlot(p, slot, day);
  return !t || t.status !== 'pending';
};

const isValidSlot = (slot) => Number.isInteger(slot) && slot >= 0 && slot < CATEGORY_COUNT;
const validUrgency = (urgency, fallback = 'normal') => (URGENCIES.includes(urgency) ? urgency : fallback);
const remove = (list, x) => list.splice(list.indexOf(x), 1);

/** 'added' | 'empty' | 'slotBusy' | 'invalidCategory'. A finished task in the slot is replaced (no history). */
export function addToSlot(p, slot, text, urgency, day, newId = () => crypto.randomUUID()) {
  if (!isValidSlot(slot)) return 'invalidCategory';
  const clean = cleanText(text);
  if (!clean) return 'empty';
  if (!isSlotFree(p, slot, day)) return 'slotBusy';
  placeInSlot(p, { id: newId(), date: day, slot, text: clean, urgency: validUrgency(urgency), status: 'pending', backlogId: null });
  return 'added';
}

/**
 * HOY add form: a new task in the chosen category's slot when free, else the first free slot (the 5-task limit
 * holds). Returns { result: 'added' | 'empty' | 'noFreeSlot' | 'invalidCategory', slot? }.
 */
export function addToFreeSlot(p, text, urgency, day, preferred, newId = () => crypto.randomUUID()) {
  if (!cleanText(text)) return { result: 'empty' };
  const free = freeSlots(p, day);
  if (!free.length) return { result: 'noFreeSlot' };
  const slot = free.includes(preferred) ? preferred : free[0];
  return { result: addToSlot(p, slot, text, urgency, day, newId), slot };
}

/** Puts a task into its (free) slot, replacing a finished one there. */
function placeInSlot(p, task) {
  const previous = currentInSlot(p, task.slot, task.date);
  if (previous && previous !== task) remove(p.slotTasks, previous);
  if (!p.slotTasks.includes(task)) p.slotTasks.push(task);
}

/** Free slots for a day, in the user's slot order. */
export const freeSlots = (p, day) => normalizeSlotOrder(p.slotOrder).filter((slot) => isSlotFree(p, slot, day));

/**
 * Edits a daily task: text, urgency and category (= slot; the target slot must be free). Id, status and date stay.
 * A linked TODO item follows (text, urgency, category). 'updated' | 'empty' | 'notFound' | 'slotBusy' | 'invalidCategory'.
 */
export function updateSlotTask(p, id, text, urgency, slot) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return 'notFound';
  const clean = cleanText(text);
  if (!clean) return 'empty';
  if (!isValidSlot(slot)) return 'invalidCategory';
  if (slot !== t.slot && !isSlotFree(p, slot, t.date)) return 'slotBusy';
  t.text = clean;
  t.urgency = validUrgency(urgency, t.urgency);
  if (slot !== t.slot) {
    t.slot = slot;
    placeInSlot(p, t);
  }
  const item = linkedItem(p, t);
  if (item) editItem(p, item, clean, t.slot, t.urgency);
  return 'updated';
}

/** Removes a daily task (a linked TODO item stays as it is); today's slot is then auto-filled. */
export function deleteSlotTask(p, id, day) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return false;
  const freesToday = isTodaysCurrent(p, t, day);
  remove(p.slotTasks, t);
  if (freesToday) autoFill(p, t.slot, day);
  return true;
}

const isTodaysCurrent = (p, t, day) => t.date === day && currentInSlot(p, t.slot, day) === t;

/** The TODO item auto-fill would move into the slot: open, same category, not already today's task; most urgent
 * first, then saved category order, then oldest (desktop Planner.NextAutoFillCandidate). */
export function nextAutoFillCandidate(p, slot, day) {
  return p.backlog.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === 'open' && item.category === slot && !todayTaskFor(p, item.id, day))
    .sort((a, b) => URGENCIES.indexOf(a.item.urgency) - URGENCIES.indexOf(b.item.urgency)
      || (a.item.categoryOrder ?? 0) - (b.item.categoryOrder ?? 0) || a.index - b.index)
    .map(({ item }) => item)[0] ?? null;
}

function autoFill(p, slot, day) {
  const next = isSlotFree(p, slot, day) ? nextAutoFillCandidate(p, slot, day) : null;
  if (next) moveIntoSlot(p, next, slot, day);
}

const linkedItem = (p, t) => (t.backlogId ? p.backlog.find((b) => b.id === t.backlogId) ?? null : null);

/** Done/cancelled/pending. A linked TODO item follows like on the desktop: done closes it, undo/cancel reopens it.
 * Done keeps the task in its slot (no auto-fill), so UNDO works. */
export function setSlotStatus(p, id, status) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return false;
  t.status = status;
  const item = linkedItem(p, t);
  if (item && status === 'done') item.status = 'done';
  else if (item && item.status === 'done') item.status = 'open'; // un-ticked or cancelled today
  return true;
}

export function addBacklog(p, text, category, urgency, newId = () => crypto.randomUUID()) {
  const clean = cleanText(text);
  if (!clean) return 'empty';
  if (!isValidSlot(category)) return 'invalidCategory';
  p.backlog.push(newItem(p, newId(), clean, category, validUrgency(urgency)));
  return 'added';
}

/** A new open item at the end of its category and urgency groups. */
function newItem(p, id, text, category, urgency) {
  return { id, text, category, urgency, status: 'open',
    categoryOrder: nextOrder(p, (b) => b.category === category, 'categoryOrder'),
    urgencyOrder: nextOrder(p, (b) => b.urgency === urgency, 'urgencyOrder') };
}

function nextOrder(p, inGroup, key) {
  const group = p.backlog.filter(inGroup);
  return group.length ? Math.max(...group.map((b) => b[key] ?? 0)) + 1 : 0;
}

/** Changing category/urgency puts the item at the end of its new group (like the desktop). */
function editItem(p, item, text, category, urgency) {
  if (category !== item.category) {
    item.categoryOrder = nextOrder(p, (b) => b !== item && b.category === category, 'categoryOrder');
    item.category = category;
  }
  if (urgency !== item.urgency) {
    item.urgencyOrder = nextOrder(p, (b) => b !== item && b.urgency === urgency, 'urgencyOrder');
    item.urgency = urgency;
  }
  item.text = text;
}

/** Today's pending task made from this TODO item, if any. */
export function todayTaskFor(p, itemId, day) {
  return p.slotTasks.find((t) => t.backlogId === itemId && t.date === day && t.status === 'pending' && currentInSlot(p, t.slot, day) === t) ?? null;
}

/** Edits a TODO item; text and urgency go to today's pending task too. 'updated' | 'empty' | 'notFound' | 'invalidCategory'. */
export function updateBacklog(p, id, text, category, urgency, day) {
  const item = p.backlog.find((b) => b.id === id);
  if (!item) return 'notFound';
  const clean = cleanText(text);
  if (!clean) return 'empty';
  if (!isValidSlot(category)) return 'invalidCategory';
  editItem(p, item, clean, category, validUrgency(urgency, item.urgency));
  const today = todayTaskFor(p, id, day);
  if (today) Object.assign(today, { text: item.text, urgency: item.urgency });
  return 'updated';
}

/** Ticks a TODO item done; today's pending task made from it is closed too (desktop SetBacklogStatus). */
export function completeBacklog(p, id, day) {
  const item = p.backlog.find((b) => b.id === id);
  if (!item) return false;
  item.status = 'done';
  const today = todayTaskFor(p, id, day);
  if (today) today.status = 'done';
  return true;
}

/** Deletes a TODO item; daily tasks made from it stay, unlinked. */
export function deleteBacklog(p, id) {
  const item = p.backlog.find((b) => b.id === id);
  if (!item) return false;
  remove(p.backlog, item);
  for (const t of p.slotTasks) if (t.backlogId === id) t.backlogId = null;
  return true;
}

/** Open TODO items in creation order (the order they were added to the list). */
export const openBacklog = (p) => p.backlog.filter((b) => b.status === 'open');

/** Open TODO items grouped by category (in the user's slot order), saved order inside a group; empty groups left out. */
export function backlogByCategory(p) {
  return normalizeSlotOrder(p.slotOrder).map((category) => ({ category,
    items: openBacklog(p).filter((b) => b.category === category).sort((a, b) => (a.categoryOrder ?? 0) - (b.categoryOrder ?? 0)) }))
    .filter((g) => g.items.length);
}

/** Open TODO items grouped by urgency, most urgent first; inside a group in saved order. Empty groups are left out. */
export function backlogByUrgency(p) {
  return URGENCIES.map((urgency) => ({ urgency,
    items: openBacklog(p).filter((b) => b.urgency === urgency).sort((a, b) => (a.urgencyOrder ?? 0) - (b.urgencyOrder ?? 0)) }))
    .filter((g) => g.items.length);
}

/**
 * Moves an open TODO item into today's 5 (desktop Planner.Assign / SendToToday): the item leaves the TODO list and the
 * task takes its id, so sync sees one task, never a copy. It lands in `preferred` if free, else its own category's
 * slot, else the first free slot; with all 5 busy the least important pending task goes back to TODO (own id,
 * category = slot, urgency) and the item takes its slot.
 * Returns { result: 'moved' | 'swapped' | 'alreadyThere' | 'notOpen' | 'notFound' | 'invalidSlot', slot? }.
 */
export function sendToToday(p, itemId, day, preferred = null) {
  if (preferred !== null && !isValidSlot(preferred)) return { result: 'invalidSlot' };
  const item = p.backlog.find((b) => b.id === itemId);
  if (!item) return { result: 'notFound' };
  if (item.status !== 'open') return { result: 'notOpen' };
  const atPreferred = preferred === null ? null : currentInSlot(p, preferred, day);
  if (atPreferred?.status === 'pending' && atPreferred.backlogId === itemId) return { result: 'alreadyThere' };
  const legacyCopy = todayTaskFor(p, itemId, day); // linked copy made by v2.31 or older
  if (legacyCopy) remove(p.slotTasks, legacyCopy);
  const slot = targetSlotFor(p, item, preferred, day);
  const displaced = currentInSlot(p, slot, day);
  const swapped = displaced?.status === 'pending';
  if (swapped) returnToBacklog(p, displaced);
  moveIntoSlot(p, item, slot, day);
  return { result: swapped ? 'swapped' : 'moved', slot };
}

/** Where a TODO item moving into today lands (desktop Planner.TargetSlotFor). */
export function targetSlotFor(p, item, preferred, day) {
  if (preferred !== null && isSlotFree(p, preferred, day)) return preferred;
  if (isSlotFree(p, item.category, day)) return item.category;
  return freeSlots(p, day)[0] ?? leastImportantPending(p, day)?.slot ?? item.category;
}

/** Today's pending task that makes room when all 5 are busy: lowest urgency; ties: the oldest = earliest in the
 * stored task list (tasks are appended when created; carry-over keeps the place). Desktop LeastImportantPending. */
export function leastImportantPending(p, day) {
  return p.slotTasks.map((t, index) => ({ t, index }))
    .filter(({ t }) => t.status === 'pending' && isTodaysCurrent(p, t, day))
    .sort((a, b) => URGENCIES.indexOf(b.t.urgency) - URGENCIES.indexOf(a.t.urgency) || a.index - b.index)
    .map(({ t }) => t)[0] ?? null;
}

/** Takes the item out of the TODO list and makes it today's task in the slot, with the item's id. */
function moveIntoSlot(p, item, slot, day) {
  remove(p.backlog, item);
  for (const t of p.slotTasks) if (t.backlogId === item.id) t.backlogId = null;
  placeInSlot(p, { id: item.id, date: day, slot, text: item.text, urgency: item.urgency, status: 'pending', backlogId: null });
}

/** HOY reorder (long-press drag, desktop SlotOrdering.Move): puts a slot at display row newIndex; false when nothing changes. */
export function moveSlotRow(p, slot, newIndex) {
  const order = normalizeSlotOrder(p.slotOrder);
  const from = order.indexOf(slot);
  const to = Math.max(0, Math.min(order.length - 1, newIndex));
  if (from < 0 || from === to) return false;
  order.splice(from, 1);
  order.splice(to, 0, slot);
  p.slotOrder = order;
  return true;
}

/** Day change: the newest unfinished task of each slot moves to today if today's slot is free, other
 * unfinished ones go back to the TODO list; finished past tasks are dropped. Returns {carried, returned}. */
export function ensureRollover(p, today) {
  const result = { carried: 0, returned: 0 };
  if (p.lastRolloverDate === today) {
    p.slotTasks = p.slotTasks.filter((t) => t.date >= today);
    return result;
  }
  // Newest day first; within one day the later-added task first (like the desktop).
  const past = p.slotTasks.map((t, index) => ({ t, index }))
    .filter(({ t }) => t.date < today && t.status === 'pending')
    .sort((a, b) => (a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : b.index - a.index))
    .map(({ t }) => t);
  for (const t of past) {
    if (!currentInSlot(p, t.slot, today)) {
      t.date = today;
      result.carried++;
    } else {
      returnToBacklog(p, t);
      result.returned++;
    }
  }
  p.slotTasks = p.slotTasks.filter((t) => t.date >= today);
  p.lastRolloverDate = today;
  return result;
}

function returnToBacklog(p, t) {
  p.slotTasks.splice(p.slotTasks.indexOf(t), 1);
  // The TODO item takes the task's own id: two devices returning the same task give ONE item after sync.
  const item = linkedItem(p, t) ?? p.backlog.find((b) => b.id === t.id);
  if (item) {
    item.status = 'open';
    return;
  }
  p.backlog.push(newItem(p, t.id, t.text, t.slot, t.urgency));
}
