// Planner rules for the PWA, mirroring src/SoaringHigh5.Core/Planner.cs: five slots (one per category), one task
// per slot and day, TODO list grouped by category/urgency, day change carries pending tasks over. Pure functions on
// plain data (no DOM); sync stamps (updatedAt) are added by merge.stamp() from the diff, so edits here sync as usual.
// Moving a TODO item to today takes it OUT of the list into its own category's slot (the task keeps the item's id;
// the less important of it and the pending task there stays in / goes back to TODO); deleting today's task auto-fills the slot with the most urgent open item
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

/**
 * Removes a daily task (a linked TODO item stays as it is); today's slot is then auto-filled. Returns an undo record
 * for undoDelete (truthy), or false when the task is gone.
 */
export function deleteSlotTask(p, id, day) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return false;
  const freesToday = isTodaysCurrent(p, t, day);
  const taskIndex = p.slotTasks.indexOf(t);
  remove(p.slotTasks, t);
  const filled = freesToday ? autoFill(p, t.slot, day) : null;
  return { task: t, taskIndex, item: filled?.item ?? null, itemIndex: filled?.index ?? -1 };
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

/** Fills a freed slot; returns { item, index } (its former TODO position, for undo) or null. */
function autoFill(p, slot, day) {
  const next = isSlotFree(p, slot, day) ? nextAutoFillCandidate(p, slot, day) : null;
  if (!next) return null;
  const index = p.backlog.indexOf(next);
  moveIntoSlot(p, next, slot, day);
  return { item: next, index };
}

const linkedItem = (p, t) => (t.backlogId ? p.backlog.find((b) => b.id === t.backlogId) ?? null : null);

/** Done/cancelled/pending. A linked TODO item follows like on the desktop: done closes it, undo/cancel reopens it.
 * Done keeps the task in its slot (no auto-fill), so UNDO works. */
export function setSlotStatus(p, id, status, now = new Date()) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return false;
  setStatus(t, status, now);
  const item = linkedItem(p, t);
  if (item && status === 'done') setStatus(item, 'done', now);
  else if (item && item.status === 'done') setStatus(item, 'open', now); // un-ticked or cancelled today
  return true;
}

/** Status plus the DONE timestamp (ISO, UTC), kept only while done (desktop SetTaskStatus/SetItemStatus). */
function setStatus(x, status, now) {
  x.status = status;
  x.doneAt = status === 'done' ? x.doneAt ?? new Date(now).toISOString() : null;
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
export function completeBacklog(p, id, day, now = new Date()) {
  const item = p.backlog.find((b) => b.id === id);
  if (!item) return false;
  const today = todayTaskFor(p, id, day);
  setStatus(item, 'done', now);
  if (today) setStatus(today, 'done', now);
  return true;
}

/** UNDO / restore of a done TODO item: open again; today's closed task made from it reopens (desktop SetBacklogStatus). */
export function reopenBacklog(p, id, day) {
  const item = p.backlog.find((b) => b.id === id);
  if (!item || item.status === 'open') return false;
  setStatus(item, 'open');
  const today = p.slotTasks.find((t) => t.backlogId === id && isTodaysCurrent(p, t, day));
  if (today && today.status !== 'pending') setStatus(today, 'pending');
  return true;
}

/** Deletes a TODO item; daily tasks made from it stay, unlinked. Returns an undo record (truthy) or false. */
export function deleteBacklog(p, id) {
  const item = p.backlog.find((b) => b.id === id);
  if (!item) return false;
  const itemIndex = p.backlog.indexOf(item);
  remove(p.backlog, item);
  for (const t of p.slotTasks) if (t.backlogId === id) t.backlogId = null;
  return { task: null, taskIndex: -1, item, itemIndex };
}

/** Open TODO items in creation order (the order they were added to the list). */
export const openBacklog = (p) => p.backlog.filter((b) => b.status === 'open');

/** Done TODO items stay visible (struck through, with UNDO) this long in the TODO and URGENCY tabs. */
export const DONE_VISIBLE_MS = 48 * 3600 * 1000;
/** Done TODO items are removed this long after they were ticked (desktop Planner.DoneRetention). */
export const DONE_RETENTION_MS = 30 * 24 * 3600 * 1000;

const isRecentlyDone = (b, now) => b.status === 'done' && b.doneAt && now - Date.parse(b.doneAt) < DONE_VISIBLE_MS;

/** Items listed in the TODO tabs: open ones, then the ones done in the last 48 h. */
const listedBacklog = (p, now) => [...openBacklog(p), ...p.backlog.filter((b) => isRecentlyDone(b, now))];

/** Groups in `keys` order; open items first in saved order, then recently done ones; empty groups left out. */
function groupBacklog(p, now, keys, keyOf, orderKey) {
  const rank = (b) => (b.status === 'open' ? 0 : 1);
  return keys.map((key) => ({ key,
    items: listedBacklog(p, now).filter((b) => keyOf(b) === key).sort((a, b) => rank(a) - rank(b) || (a[orderKey] ?? 0) - (b[orderKey] ?? 0)) }))
    .filter((g) => g.items.length);
}

/** TODO tab: by category (in the user's slot order). Done items from the last 48 h are included (struck through). */
export function backlogByCategory(p, now = Date.now()) {
  return groupBacklog(p, now, normalizeSlotOrder(p.slotOrder), (b) => b.category, 'categoryOrder')
    .map(({ key, items }) => ({ category: key, items }));
}

/** URGENCY tab: by urgency, most urgent first. Done items from the last 48 h are included (struck through). */
export function backlogByUrgency(p, now = Date.now()) {
  return groupBacklog(p, now, URGENCIES, (b) => b.urgency, 'urgencyOrder')
    .map(({ key, items }) => ({ urgency: key, items }));
}

/**
 * DONE tab (desktop Planner.DoneEntries): today's done tasks still in their slot and done TODO items, newest first;
 * items without a timestamp (finished before v2.39) last. Entries: { id, isToday, text, category, urgency, doneAt }.
 */
export function doneEntries(p, day) {
  const today = normalizeSlotOrder([]).map((slot) => currentInSlot(p, slot, day)).filter((t) => t?.status === 'done')
    .map((t) => ({ id: t.id, isToday: true, text: t.text, category: t.slot, urgency: t.urgency, doneAt: t.doneAt ?? null }));
  const items = p.backlog.filter((b) => b.status === 'done')
    .map((b) => ({ id: b.id, isToday: false, text: b.text, category: b.category, urgency: b.urgency, doneAt: b.doneAt ?? null }));
  const time = (e) => (e.doneAt ? Date.parse(e.doneAt) : -Infinity);
  return [...today, ...items].sort((a, b) => time(b) - time(a));
}

/** Restores a DONE entry: today's task pending again, a TODO item open again (desktop RestoreDone). */
export function restoreDone(p, id, day) {
  const task = p.slotTasks.find((t) => t.id === id && t.status === 'done');
  if (task) return isTodaysCurrent(p, task, day) && setSlotStatus(p, id, 'pending');
  return reopenBacklog(p, id, day);
}

/** Retention: done TODO items older than 30 days are removed; undated ones (pre-v2.39) get a stamp first. */
export function purgeOldDone(p, now = new Date()) {
  const at = new Date(now);
  for (const b of p.backlog) if (b.status === 'done' && !b.doneAt) b.doneAt = at.toISOString();
  const before = p.backlog.length;
  p.backlog = p.backlog.filter((b) => !(b.status === 'done' && at - Date.parse(b.doneAt) > DONE_RETENTION_MS));
  return before - p.backlog.length;
}

/**
 * Reverses deleteSlotTask/deleteBacklog (desktop Planner.Undo): the auto-filled item leaves its slot and returns to
 * the TODO list, the deleted task or item goes back where it was. false (nothing changed) when the task's slot got a
 * new pending task meanwhile.
 */
export function undoDelete(p, undo, day) {
  const { task, item } = undo;
  const has = (list, id) => list.some((x) => x.id === id);
  if (task && !has(p.slotTasks, task.id)) {
    const current = currentInSlot(p, task.slot, task.date);
    if (task.date === day && current?.status === 'pending' && current.id !== item?.id) return false;
  }
  if (task && item) p.slotTasks = p.slotTasks.filter((t) => !(t.id === item.id && t.status === 'pending'));
  if (item && !has(p.backlog, item.id) && !has(p.slotTasks, item.id)) p.backlog.splice(Math.min(undo.itemIndex, p.backlog.length), 0, item);
  if (task && !has(p.slotTasks, task.id)) p.slotTasks.splice(Math.min(undo.taskIndex, p.slotTasks.length), 0, task);
  return true;
}

/** The incoming item wins its slot when it is at least as urgent as the pending task there: on a tie the task
 * already in the slot is the older one, so it goes back (desktop Planner.Outranks). */
export const outranks = (incoming, current) => URGENCIES.indexOf(incoming) <= URGENCIES.indexOf(current);

/**
 * The -> HOY button (desktop Planner.SendToToday): the item goes to its OWN category's slot and leaves the TODO list;
 * the task takes its id, so sync sees one task, never a copy. A pending task there that is less important (or equally
 * important, hence older) goes back to TODO with its id, category and urgency; a more important one keeps the slot.
 * Returns { result: 'moved' | 'swapped' | 'outranked' | 'alreadyThere' | 'notOpen' | 'notFound', slot? }.
 */
export function sendToToday(p, itemId, day) {
  const item = p.backlog.find((b) => b.id === itemId);
  if (!item) return { result: 'notFound' };
  if (item.status !== 'open') return { result: 'notOpen' };
  const slot = item.category;
  const current = currentInSlot(p, slot, day);
  const busy = current?.status === 'pending';
  if (busy && current.backlogId === itemId) return { result: 'alreadyThere' };
  if (busy && !outranks(item.urgency, current.urgency)) return { result: 'outranked', slot };
  const legacyCopy = todayTaskFor(p, itemId, day); // linked copy made by v2.31 or older
  if (legacyCopy) remove(p.slotTasks, legacyCopy);
  if (busy) returnToBacklog(p, current);
  moveIntoSlot(p, item, slot, day);
  return { result: busy ? 'swapped' : 'moved', slot };
}

/** Takes the item out of the TODO list and makes it today's task in the slot, with the item's id. */
function moveIntoSlot(p, item, slot, day) {
  remove(p.backlog, item);
  for (const t of p.slotTasks) if (t.backlogId === item.id) t.backlogId = null;
  placeInSlot(p, { id: item.id, date: day, slot, text: item.text, urgency: item.urgency, status: 'pending', backlogId: null });
}

/** Sort key of a slot on HOY: its task's urgency (pending or done alike); empty slots last. */
const urgencyRank = (p, slot, day) => {
  const task = currentInSlot(p, slot, day);
  return task ? URGENCIES.indexOf(task.urgency) : URGENCIES.length;
};

/**
 * HOY display order (display only; the saved slot order and the data stay as they are): most urgent first, ties in
 * the saved slot order, empty slots last. Done tasks keep their urgency's place, so ticking one does not make the
 * list jump.
 */
export function displaySlots(p, day) {
  return normalizeSlotOrder(p.slotOrder).map((slot, index) => ({ slot, index, rank: urgencyRank(p, slot, day) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ slot }) => slot);
}

/**
 * HOY long-press reorder: moves the row at display index `from` to `to`, only among rows of the same urgency.
 * Only the relative order of that group changes in the saved slot order (the group keeps its positions there, so
 * other slots and the desktop's order of them are untouched). Returns 'moved' | 'unchanged' | 'otherUrgency'.
 */
export function reorderWithinUrgency(p, day, from, to) {
  const rows = displaySlots(p, day);
  if (from === to || rows[from] === undefined || rows[to] === undefined) return 'unchanged';
  const rank = urgencyRank(p, rows[from], day);
  if (urgencyRank(p, rows[to], day) !== rank) return 'otherUrgency';
  const group = rows.filter((slot) => urgencyRank(p, slot, day) === rank);
  const moved = rows[from];
  group.splice(group.indexOf(moved), 1);
  group.splice(group.indexOf(rows[to]) + (from < to ? 1 : 0), 0, moved);
  const order = normalizeSlotOrder(p.slotOrder);
  const positions = order.map((slot, index) => (group.includes(slot) ? index : -1)).filter((index) => index >= 0);
  positions.forEach((position, k) => { order[position] = group[k]; });
  p.slotOrder = order;
  return 'moved';
}

/** Day change: the newest unfinished task of each slot moves to today if today's slot is free, other
 * unfinished ones go back to the TODO list; finished past tasks are dropped. Returns {carried, returned}. */
export function ensureRollover(p, today, now = new Date()) {
  const result = { carried: 0, returned: 0 };
  purgeOldDone(p, now);
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
