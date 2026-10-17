// Sync rules of SoaringHigh-5, mirroring src/SoaringHigh5.Core/Sync/SyncMerge.cs (keep both in step).
// Pure functions, no DOM: used by the app and by `node --test`.

export const FORMAT = 'soaringhigh5-sync';
export const VERSION = 1;
export const FILE_NAME = 'soaringhigh5-sync.json';
export const CATEGORY_COUNT = 5;
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const TOMBSTONE_LIFETIME_MS = 30 * 24 * 3600 * 1000;
export const MAX_CONFLICTS = 50;
export const URGENCIES = ['urgentImportant', 'urgent', 'important', 'normal', 'wish'];
const MIN_STAMP = '0001-01-01T00:00:00.000Z';

const ms = (iso) => (iso ? Date.parse(iso) : Date.parse(MIN_STAMP));
const iso = (t) => new Date(t).toISOString();
const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // like string.CompareOrdinal for ASCII ids
const clone = (x) => JSON.parse(JSON.stringify(x));

export function emptyDocument() {
  return { format: FORMAT, version: VERSION, updatedAt: MIN_STAMP, deviceId: '', slotTasks: [], backlog: [],
    slotOrder: null, categoryNames: null, lastRolloverDate: null, conflicts: [] };
}

export function normalizeSlotOrder(order) {
  const seen = [];
  for (const s of order || []) if (Number.isInteger(s) && s >= 0 && s < CATEGORY_COUNT && !seen.includes(s)) seen.push(s);
  for (let s = 0; s < CATEGORY_COUNT; s++) if (!seen.includes(s)) seen.push(s);
  return seen;
}

const TASK_FIELDS = ['deleted', 'date', 'slot', 'text', 'urgency', 'status', 'backlogId', 'doneAt'];
const ITEM_FIELDS = ['deleted', 'text', 'category', 'urgency', 'status', 'categoryOrder', 'urgencyOrder', 'doneAt'];
const same = (fields) => (a, b) => fields.every((f) => (a[f] ?? null) === (b[f] ?? null));
export const sameTask = same(TASK_FIELDS);
export const sameItem = same(ITEM_FIELDS);
const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []); // arrays of numbers/strings

/** Parses the Drive file; null if it is not ours or newer than we understand. */
export function parseDocument(text) {
  if (!text || !text.trim()) return null;
  try {
    const doc = JSON.parse(text);
    if (!doc || doc.format !== FORMAT || doc.version > VERSION) return null;
    doc.slotTasks = (doc.slotTasks || []).map(withDefaults);
    doc.backlog = (doc.backlog || []).map(withDefaults);
    doc.conflicts = doc.conflicts || [];
    return doc;
  } catch {
    return null;
  }
}

function withDefaults(item) {
  return { updatedAt: MIN_STAMP, deviceId: '', deleted: false, ...item };
}

// ------------------------------------------------------------------ stamp

/** Local planner {slotTasks, backlog, slotOrder, lastRolloverDate} + last snapshot → this device's document. */
export function stamp(planner, snapshot, now, deviceId, categoryNames = null) {
  const at = iso(now);
  return {
    format: FORMAT, version: VERSION, updatedAt: at, deviceId,
    slotTasks: stampItems(planner.slotTasks, snapshot?.slotTasks, at, deviceId, sameTask),
    backlog: stampItems(planner.backlog, snapshot?.backlog, at, deviceId, sameItem),
    slotOrder: stampRegister(normalizeSlotOrder(planner.slotOrder), snapshot?.slotOrder, at, deviceId),
    categoryNames: categoryNames === null ? (snapshot?.categoryNames ?? null) : stampRegister(categoryNames, snapshot?.categoryNames, at, deviceId),
    lastRolloverDate: planner.lastRolloverDate ?? null,
    conflicts: [...(snapshot?.conflicts || [])],
  };
}

function stampItems(current, snapshotItems, at, deviceId, isSame) {
  const previous = new Map((snapshotItems || []).map((i) => [i.id, i]));
  const result = [];
  for (const raw of current || []) {
    const item = { ...clone(raw), deleted: false };
    const before = previous.get(item.id);
    previous.delete(item.id);
    if (before && isSame(item, before)) Object.assign(item, { updatedAt: before.updatedAt, deviceId: before.deviceId });
    else Object.assign(item, { updatedAt: at, deviceId });
    result.push(item);
  }
  for (const gone of previous.values())
    result.push(gone.deleted ? clone(gone) : { ...clone(gone), deleted: true, updatedAt: at, deviceId });
  return result;
}

function stampRegister(value, snapshot, at, deviceId) {
  if (snapshot && sameList(value, snapshot.value)) return { value, updatedAt: snapshot.updatedAt, deviceId: snapshot.deviceId };
  return { value, updatedAt: at, deviceId };
}

// ------------------------------------------------------------------ merge

export function effective(updatedAt, now) {
  return Math.min(ms(updatedAt), now + MAX_CLOCK_SKEW_MS);
}

/** Newer wins; equal: higher device id, then the tombstone. */
export function firstWins(a, b, now) {
  const byTime = effective(a.updatedAt, now) - effective(b.updatedAt, now);
  if (byTime !== 0) return byTime > 0;
  const byDevice = ordinal(a.deviceId || '', b.deviceId || '');
  if (byDevice !== 0) return byDevice > 0;
  return !!a.deleted || !b.deleted;
}

export function merge(local, remote, base, now, deviceId) {
  const at = iso(now);
  const conflicts = [];
  const merged = {
    format: FORMAT, version: VERSION, updatedAt: at, deviceId,
    slotTasks: mergeItems(local.slotTasks, remote?.slotTasks, base?.slotTasks, now, at, 'slotTask', sameTask, describeTask, conflicts),
    backlog: mergeItems(local.backlog, remote?.backlog, base?.backlog, now, at, 'backlog', sameItem, describeItem, conflicts),
    slotOrder: mergeRegister(local.slotOrder, remote?.slotOrder, base?.slotOrder, now, at, 'slotOrder', conflicts),
    categoryNames: mergeRegister(local.categoryNames, remote?.categoryNames, base?.categoryNames, now, at, 'categoryNames', conflicts),
    lastRolloverDate: maxDate(local.lastRolloverDate, remote?.lastRolloverDate),
    conflicts: [],
  };
  merged.conflicts = capConflicts([...(local.conflicts || []), ...(remote?.conflicts || []), ...conflicts]);
  merged.slotTasks = merged.slotTasks.filter((t) => !(t.deleted && ms(t.updatedAt) < now - TOMBSTONE_LIFETIME_MS));
  merged.backlog = merged.backlog.filter((b) => !(b.deleted && ms(b.updatedAt) < now - TOMBSTONE_LIFETIME_MS));
  normalize(merged, now);
  return merged;
}

function byId(items) {
  return new Map((items || []).map((i) => [i.id, i]));
}

function mergeItems(local, remote, base, now, at, kind, isSame, describe, conflicts) {
  const mine = byId(local), theirs = byId(remote), common = byId(base);
  const ids = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
  const changed = (x, id) => { const b = common.get(id); return !b || b.updatedAt !== x.updatedAt || b.deviceId !== x.deviceId; };
  return ids.map((id) => {
    const a = mine.get(id), b = theirs.get(id);
    if (!a || !b) return clone(a || b);
    const winner = firstWins(a, b, now) ? a : b;
    const loser = winner === a ? b : a;
    if (!isSame(a, b) && changed(a, id) && changed(b, id))
      conflicts.push({ at, kind, id, keptDevice: winner.deviceId, lostDevice: loser.deviceId, lost: describe(loser) });
    return clone(winner);
  });
}

function mergeRegister(a, b, common, now, at, kind, conflicts) {
  if (!a || !b) return a || b || null;
  const ea = effective(a.updatedAt, now), eb = effective(b.updatedAt, now);
  const aWins = ea !== eb ? ea > eb : ordinal(a.deviceId || '', b.deviceId || '') >= 0;
  const [winner, loser] = aWins ? [a, b] : [b, a];
  const differs = (x) => x.updatedAt !== common.updatedAt || x.deviceId !== common.deviceId;
  const bothChanged = !common || (differs(a) && differs(b));
  if (!sameList(a.value, b.value) && bothChanged)
    conflicts.push({ at, kind, id: null, keptDevice: winner.deviceId, lostDevice: loser.deviceId, lost: (loser.value || []).join(', ') });
  return clone(winner);
}

function maxDate(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b; // yyyy-MM-dd compares as text
}

const describeTask = (t) => (t.deleted ? `(deleted) ${t.text}` : `${t.date} #${t.slot} ${cap(t.status)}: ${t.text}`);
const describeItem = (b) => (b.deleted ? `(deleted) ${b.text}` : `${cap(b.status)}: ${b.text}`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function capConflicts(list) {
  const seen = new Set();
  const unique = [];
  for (const c of list) {
    const key = JSON.stringify([c.at, c.kind, c.id ?? null, c.lostDevice, c.lost]);
    if (!seen.has(key)) { seen.add(key); unique.push(c); }
  }
  unique.sort((x, y) => ms(y.at) - ms(x.at) || ordinal(x.kind, y.kind) || ordinal(x.id ?? '', y.id ?? ''));
  return unique.slice(0, MAX_CONFLICTS);
}

// ------------------------------------------------------------------ planner rules

/** One task per slot and day (pending first, then newest); a pending loser goes back to the TODO list. */
export function normalize(doc, now) {
  const at = iso(now);
  for (const t of doc.slotTasks) if (!t.deleted && !(Number.isInteger(t.slot) && t.slot >= 0 && t.slot < CATEGORY_COUNT)) t.deleted = true;
  const groups = new Map();
  for (const t of doc.slotTasks.filter((x) => !x.deleted)) {
    const key = `${t.date}|${t.slot}`;
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((x, y) =>
      (isPending(y) - isPending(x)) || (effective(y.updatedAt, now) - effective(x.updatedAt, now))
      || ordinal(y.deviceId || '', x.deviceId || '') || ordinal(x.id, y.id));
    for (const loser of group.slice(1)) resolveClashLoser(doc, loser, group[0], at);
  }
  dropBacklogCopiesOfLiveTasks(doc);
  removeDuplicateOpenItems(doc, now, at);
  if (doc.slotOrder) doc.slotOrder.value = normalizeSlotOrder(doc.slotOrder.value);
  doc.conflicts = capConflicts(doc.conflicts);
}

/** A task returned to TODO on one device (item id = task id) but carried over on another: drop the TODO copy. */
function dropBacklogCopiesOfLiveTasks(doc) {
  const live = new Set(doc.slotTasks.filter((t) => !t.deleted).map((t) => t.id));
  for (const b of doc.backlog) if (!b.deleted && live.has(b.id)) b.deleted = true;
}

/** Open TODO items with the same text + category collapse to the newest; links follow; each drop is logged. */
function removeDuplicateOpenItems(doc, now, at) {
  const groups = new Map();
  for (const b of doc.backlog.filter((x) => !x.deleted && (x.status ?? 'open') === 'open')) {
    const key = JSON.stringify([b.text, b.category]);
    groups.set(key, [...(groups.get(key) || []), b]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((x, y) => (effective(y.updatedAt, now) - effective(x.updatedAt, now)) || ordinal(y.deviceId || '', x.deviceId || '') || ordinal(x.id, y.id));
    const kept = group[0];
    for (const dup of group.slice(1)) {
      dup.deleted = true;
      for (const t of doc.slotTasks) if (!t.deleted && t.backlogId === dup.id) t.backlogId = kept.id;
      doc.conflicts.push({ at, kind: 'dedup', id: dup.id, keptDevice: kept.deviceId, lostDevice: dup.deviceId, lost: describeItem(dup) + ' (duplicate)' });
    }
  }
}

const isPending = (t) => (t.status ?? 'pending') === 'pending' ? 1 : 0;

function resolveClashLoser(doc, loser, kept, at) {
  loser.deleted = true;
  if (!isPending(loser)) return;
  returnToBacklog(doc, loser);
  doc.conflicts.push({ at, kind: 'slotClash', id: loser.id, keptDevice: kept.deviceId, lostDevice: loser.deviceId, lost: describeTask(loser) + ' → TODO' });
}

function returnToBacklog(doc, task) {
  const linked = task.backlogId ? doc.backlog.find((b) => b.id === task.backlogId && !b.deleted) : null;
  if (linked) {
    if (linked.status !== 'open') {
      linked.status = 'open';
      linked.updatedAt = ms(linked.updatedAt) > ms(task.updatedAt) ? linked.updatedAt : task.updatedAt;
      linked.deviceId = task.deviceId;
    }
    return;
  }
  if (doc.backlog.some((b) => b.id === task.id)) return;
  const live = doc.backlog.filter((b) => !b.deleted);
  const next = (items, key) => (items.length ? Math.max(...items.map((b) => b[key] ?? 0)) + 1 : 0);
  doc.backlog.push({
    id: task.id, text: task.text, category: task.slot, urgency: task.urgency ?? 'normal', status: 'open',
    categoryOrder: next(live.filter((b) => b.category === task.slot), 'categoryOrder'),
    urgencyOrder: next(live.filter((b) => (b.urgency ?? 'normal') === (task.urgency ?? 'normal')), 'urgencyOrder'),
    updatedAt: task.updatedAt, deviceId: task.deviceId, deleted: false,
  });
}

/** Live items as planner data; moves the rollover date back if past pending tasks still need the day change. */
export function toPlanner(doc, today) {
  const strip = ({ updatedAt, deviceId, deleted, ...rest }) => rest;
  const planner = {
    slotTasks: doc.slotTasks.filter((t) => !t.deleted).sort((a, b) => ordinal(a.date, b.date) || a.slot - b.slot).map(strip),
    backlog: doc.backlog.filter((b) => !b.deleted).map(strip),
    slotOrder: normalizeSlotOrder(doc.slotOrder?.value),
    lastRolloverDate: doc.lastRolloverDate ?? null,
  };
  const needsCarryOver = planner.slotTasks.some((t) => (t.status ?? 'pending') === 'pending' && t.date < today);
  if (needsCarryOver && planner.lastRolloverDate && planner.lastRolloverDate >= today) planner.lastRolloverDate = addDays(today, -1);
  return planner;
}

/** Same content apart from the document stamp (key order and item order do not matter). */
export function sameContent(a, b) {
  const canon = (d) => stableStringify({ ...d, updatedAt: null, deviceId: null,
    slotTasks: [...d.slotTasks].sort((x, y) => ordinal(x.id, y.id)), backlog: [...d.backlog].sort((x, y) => ordinal(x.id, y.id)) });
  return canon(a) === canon(b);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
