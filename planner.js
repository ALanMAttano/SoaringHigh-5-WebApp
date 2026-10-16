// Minimal planner rules for the PWA, mirroring src/SoaringHigh5.Core/Planner.cs:
// five slots (one per category), one task per slot and day, day change carries pending tasks over.
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

/** 'added' | 'empty' | 'slotBusy' | 'invalidCategory'. A finished task in the slot is replaced (no history). */
export function addToSlot(p, slot, text, urgency, day, newId = () => crypto.randomUUID()) {
  if (!(Number.isInteger(slot) && slot >= 0 && slot < CATEGORY_COUNT)) return 'invalidCategory';
  const clean = cleanText(text);
  if (!clean) return 'empty';
  if (!isSlotFree(p, slot, day)) return 'slotBusy';
  const previous = currentInSlot(p, slot, day);
  if (previous) p.slotTasks.splice(p.slotTasks.indexOf(previous), 1);
  p.slotTasks.push({ id: newId(), date: day, slot, text: clean, urgency: URGENCIES.includes(urgency) ? urgency : 'normal', status: 'pending', backlogId: null });
  return 'added';
}

/** Done/cancelled/pending; a linked TODO item follows the task like on the desktop. */
export function setSlotStatus(p, id, status) {
  const t = p.slotTasks.find((x) => x.id === id);
  if (!t) return false;
  t.status = status;
  const item = t.backlogId ? p.backlog.find((b) => b.id === t.backlogId) : null;
  if (item) item.status = status === 'pending' ? 'open' : status;
  return true;
}

export function addBacklog(p, text, category, urgency, newId = () => crypto.randomUUID()) {
  const clean = cleanText(text);
  if (!clean) return 'empty';
  if (!(Number.isInteger(category) && category >= 0 && category < CATEGORY_COUNT)) return 'invalidCategory';
  const u = URGENCIES.includes(urgency) ? urgency : 'normal';
  p.backlog.push({ id: newId(), text: clean, category, urgency: u, status: 'open',
    categoryOrder: nextOrder(p, (b) => b.category === category, 'categoryOrder'),
    urgencyOrder: nextOrder(p, (b) => b.urgency === u, 'urgencyOrder') });
  return 'added';
}

function nextOrder(p, inGroup, key) {
  const group = p.backlog.filter(inGroup);
  return group.length ? Math.max(...group.map((b) => b[key] ?? 0)) + 1 : 0;
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
  const item = (t.backlogId ? p.backlog.find((b) => b.id === t.backlogId) : null) ?? p.backlog.find((b) => b.id === t.id);
  if (item) {
    item.status = 'open';
    return;
  }
  p.backlog.push({ id: t.id, text: t.text, category: t.slot, urgency: t.urgency, status: 'open',
    categoryOrder: nextOrder(p, (b) => b.category === t.slot, 'categoryOrder'),
    urgencyOrder: nextOrder(p, (b) => b.urgency === t.urgency, 'urgencyOrder') });
}
