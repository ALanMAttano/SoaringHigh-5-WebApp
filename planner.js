// Planner rules for the PWA, mirroring src/SoaringHigh5.Core/Planner.cs: five slots (one per category), one task
// per slot and day, TODO list grouped by category/urgency, day change carries pending tasks over. Pure functions on
// plain data (no DOM); sync stamps (updatedAt) are added by merge.stamp() from the diff, so edits here sync as usual.
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

/** Removes a daily task; a linked TODO item stays as it is (like the desktop). */
export function deleteSlotTask(p, id) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return false;
  remove(p.slotTasks, t);
  return true;
}

const linkedItem = (p, t) => (t.backlogId ? p.backlog.find((b) => b.id === t.backlogId) ?? null : null);

/** Done/cancelled/pending. A linked TODO item follows like on the desktop: done closes it, undo/cancel reopens it. */
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

/** Open TODO items grouped by urgency, most urgent first; inside a group in saved order. Empty groups are left out. */
export function backlogByUrgency(p) {
  return URGENCIES.map((urgency) => ({ urgency,
    items: openBacklog(p).filter((b) => b.urgency === urgency).sort((a, b) => (a.urgencyOrder ?? 0) - (b.urgencyOrder ?? 0)) }))
    .filter((g) => g.items.length);
}

/**
 * Sends an open TODO item to today's 5-list: its own category's slot when free, else the first free slot (the item
 * then takes that category, like dropping it there on the desktop). The item keeps its id and stays in the list,
 * linked through the task's backlogId, so sync never duplicates it.
 * Returns { result: 'sent' | 'noFreeSlot' | 'alreadyToday' | 'notOpen' | 'notFound', slot? }.
 */
export function sendToToday(p, itemId, day, newId = () => crypto.randomUUID()) {
  const item = p.backlog.find((b) => b.id === itemId);
  if (!item) return { result: 'notFound' };
  if (item.status !== 'open') return { result: 'notOpen' };
  if (todayTaskFor(p, itemId, day)) return { result: 'alreadyToday' };
  const free = freeSlots(p, day);
  if (!free.length) return { result: 'noFreeSlot' };
  const slot = free.includes(item.category) ? item.category : free[0];
  if (slot !== item.category) editItem(p, item, item.text, slot, item.urgency);
  placeInSlot(p, { id: newId(), date: day, slot, text: item.text, urgency: item.urgency, status: 'pending', backlogId: item.id });
  return { result: 'sent', slot };
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
