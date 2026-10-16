import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CLOCK_SKEW_MS, MAX_CONFLICTS, capConflicts, effective, firstWins, merge, parseDocument, sameContent, stamp, toPlanner } from '../merge.js';
import { addToSlot, emptyPlanner, ensureRollover, setSlotStatus, addBacklog } from '../planner.js';
import { syncOnce } from '../engine.js';

const T0 = Date.parse('2026-10-15T12:00:00.000Z');
const TODAY = '2026-10-15';
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const task = (id, text, minutes, device, extra = {}) => ({ id, text, slot: 0, status: 'pending', urgency: 'normal', date: TODAY, backlogId: null, updatedAt: at(minutes), deviceId: device, deleted: false, ...extra });
const item = (id, text, minutes, device, extra = {}) => ({ id, text, category: 0, urgency: 'normal', status: 'open', categoryOrder: 0, urgencyOrder: 0, updatedAt: at(minutes), deviceId: device, deleted: false, ...extra });
const doc = (slotTasks = [], backlog = []) => ({ format: 'soaringhigh5-sync', version: 1, slotTasks, backlog, conflicts: [], slotOrder: null, categoryNames: null, lastRolloverDate: null });

test('stamp keeps unchanged stamps, stamps edits, tombstones removals', () => {
  const snap = doc([], [item('a', 'same', 0, 'pc'), item('b', 'old', 0, 'pc'), item('c', 'bye', 0, 'pc')]);
  const planner = { slotTasks: [], backlog: [{ ...item('a', 'same', 0, 'x') }, { ...item('b', 'new', 0, 'x') }], slotOrder: [], lastRolloverDate: null };
  for (const b of planner.backlog) { delete b.updatedAt; delete b.deviceId; delete b.deleted; }
  const d = stamp(planner, snap, T0 + 300000, 'phone');
  assert.equal(d.backlog.find((x) => x.id === 'a').deviceId, 'pc');
  assert.equal(d.backlog.find((x) => x.id === 'b').updatedAt, at(5));
  assert.equal(d.backlog.find((x) => x.id === 'c').deleted, true);
});

test('last writer wins per item', () => {
  const m = merge(doc([], [item('a', 'local newer', 2, 'pc'), item('b', 'local older', 0, 'pc')]),
    doc([], [item('a', 'remote older', 1, 'phone'), item('b', 'remote newer', 3, 'phone')]), null, T0 + 240000, 'pc');
  assert.equal(m.backlog.find((x) => x.id === 'a').text, 'local newer');
  assert.equal(m.backlog.find((x) => x.id === 'b').text, 'remote newer');
});

test('tombstones: newer delete wins, newer edit beats older delete', () => {
  const m = merge(doc([], [item('a', 'x', 5, 'pc', { deleted: true }), item('b', 'y', 0, 'pc', { deleted: true })]),
    doc([], [item('a', 'x', 0, 'phone'), item('b', 'y edited', 5, 'phone')]), null, T0 + 360000, 'pc');
  assert.deepEqual(toPlanner(m, TODAY).backlog.map((b) => b.text), ['y edited']);
});

test('conflict only when both sides changed since the base; log capped newest first', () => {
  const base = doc([], [item('a', 'base', 0, 'pc')]);
  const ordinary = merge(doc([], [item('a', 'base', 0, 'pc')]), doc([], [item('a', 'phone', 1, 'phone')]), base, T0 + 120000, 'pc');
  assert.equal(ordinary.conflicts.length, 0);
  const both = merge(doc([], [item('a', 'pc edit', 2, 'pc')]), doc([], [item('a', 'phone edit', 1, 'phone')]), base, T0 + 180000, 'pc');
  assert.equal(both.conflicts.length, 1);
  assert.match(both.conflicts[0].lost, /phone edit/);
  const many = Array.from({ length: 70 }, (_, i) => ({ at: at(i), kind: 'backlog', id: null, lostDevice: '', lost: `#${i}` }));
  const capped = capConflicts([...many, ...many.slice(0, 5)]);
  assert.equal(capped.length, MAX_CONFLICTS);
  assert.equal(capped[0].lost, '#69');
});

test('clock skew: far-future stamps are clamped', () => {
  assert.equal(effective(new Date(T0 + 365 * 864e5).toISOString(), T0), T0 + MAX_CLOCK_SKEW_MS);
  const m = merge(doc([], [item('a', 'honest', 6, 'pc')]), doc([], [{ ...item('a', 'broken clock', 0, 'broken'), updatedAt: '2027-10-15T12:00:00.000Z' }]), null, T0, 'pc');
  assert.equal(m.backlog[0].text, 'honest');
});

test('ties are deterministic and the tombstone wins', () => {
  const live = item('a', 'x', 0, 'pc');
  const dead = { ...live, deleted: true };
  assert.equal(firstWins(dead, live, T0), true);
  assert.equal(firstWins(live, dead, T0), false);
});

test('5-slot limit: two pending tasks for one slot → newest stays, other to TODO', () => {
  const m = merge(doc([task('t1', 'pc task', 0, 'pc', { slot: 2 })]), doc([task('t2', 'phone task', 1, 'phone', { slot: 2 })]), null, T0 + 120000, 'pc');
  const p = toPlanner(m, TODAY);
  assert.deepEqual(p.slotTasks.map((x) => x.text), ['phone task']);
  assert.deepEqual(p.backlog.map((x) => [x.text, x.category, x.status]), [['pc task', 2, 'open']]);
  assert.ok(m.conflicts.some((c) => c.kind === 'slotClash'));
  const onPhone = merge(doc([task('t2', 'phone task', 1, 'phone', { slot: 2 })]), doc([task('t1', 'pc task', 0, 'pc', { slot: 2 })]), null, T0 + 120000, 'phone');
  assert.ok(sameContent(m, onPhone), 'both devices converge');
});

test('pending beats finished in the same slot', () => {
  const m = merge(doc([task('d', 'done', 5, 'pc', { slot: 1, status: 'done' })]), doc([task('p', 'pending', 0, 'phone', { slot: 1 })]), null, T0 + 360000, 'pc');
  assert.deepEqual(toPlanner(m, TODAY).slotTasks.map((x) => x.text), ['pending']);
});

test('day change after merge carries over a remote pending task from yesterday', () => {
  const p = emptyPlanner();
  ensureRollover(p, TODAY);
  const remote = doc([task('y', 'yesterday', -1440, 'pc', { slot: 4, date: '2026-10-14' })]);
  remote.lastRolloverDate = '2026-10-14';
  const merged = merge(stamp(p, null, T0, 'phone'), remote, null, T0, 'phone');
  const back = toPlanner(merged, TODAY);
  assert.equal(back.lastRolloverDate, '2026-10-14');
  const r = ensureRollover(back, TODAY);
  assert.equal(r.carried, 1);
  assert.equal(back.slotTasks[0].date, TODAY);
});

test('old file without stamps loads and loses to stamped edits; foreign files rejected', () => {
  const old = parseDocument('{"format":"soaringhigh5-sync","version":1,"backlog":[{"id":"a","text":"old"}]}');
  assert.equal(old.backlog[0].deviceId, '');
  assert.equal(merge(doc([], [item('a', 'new', 0, 'pc')]), old, null, T0, 'pc').backlog[0].text, 'new');
  for (const bad of ['', 'nope', '{"format":"x"}', '{"format":"soaringhigh5-sync","version":99}']) assert.equal(parseDocument(bad), null);
});

test('reads a file written by the desktop (C# JSON shape)', () => {
  const desktop = JSON.parse(readFileSync(new URL('./desktop-sample.json', import.meta.url)));
  const d = parseDocument(JSON.stringify(desktop));
  const p = toPlanner(d, TODAY);
  assert.equal(p.slotTasks[0].text, 'Pay rent');
  assert.equal(p.slotTasks[0].urgency, 'urgentImportant');
  assert.deepEqual(p.slotOrder, [4, 3, 2, 1, 0]);
});

test('planner: one pending task per slot, done frees the slot, linked item follows', () => {
  const p = emptyPlanner();
  let n = 0;
  const id = () => `id${n++}`;
  assert.equal(addToSlot(p, 0, '  first ', 'urgent', TODAY, id), 'added');
  assert.equal(addToSlot(p, 0, 'second', 'normal', TODAY, id), 'slotBusy');
  assert.equal(addToSlot(p, 9, 'x', 'normal', TODAY, id), 'invalidCategory');
  assert.equal(addToSlot(p, 1, '   ', 'normal', TODAY, id), 'empty');
  setSlotStatus(p, 'id0', 'done');
  assert.equal(addToSlot(p, 0, 'second', 'normal', TODAY, id), 'added');
  assert.deepEqual(p.slotTasks.map((x) => x.text), ['second'], 'finished task replaced, no history');
  assert.equal(addBacklog(p, 'list item', 3, 'wish', id), 'added');
  assert.equal(p.backlog[0].category, 3);
});

test('planner rollover: newest pending moves to today, older ones go to TODO, finished dropped', () => {
  const p = emptyPlanner();
  p.lastRolloverDate = '2026-10-13';
  p.slotTasks = [
    { id: 'a', date: '2026-10-13', slot: 0, text: 'older', urgency: 'normal', status: 'pending' },
    { id: 'b', date: '2026-10-14', slot: 0, text: 'newer', urgency: 'normal', status: 'pending' },
    { id: 'c', date: '2026-10-14', slot: 1, text: 'done', urgency: 'normal', status: 'done' },
  ];
  const r = ensureRollover(p, TODAY);
  assert.deepEqual(r, { carried: 1, returned: 1 });
  assert.deepEqual(p.slotTasks.map((x) => [x.text, x.date]), [['newer', TODAY]]);
  assert.deepEqual(p.backlog.map((x) => x.text), ['older']);
});

function fakeDrive(content = null) {
  return {
    content, rev: content ? 1 : 0, uploads: 0, rejected: 0, beforeVersion: null, beforeUpdate: null, afterUpdate: null, honorIfMatch: false,
    async find() { return this.content ? { id: 'f', version: String(this.rev) } : null; },
    async download() { return this.content; },
    async version() { this.beforeVersion?.(); return String(this.rev); },
    async create(c) { this.content = c; this.rev = 1; this.uploads++; return { id: 'f', version: '1' }; },
    async update(id, c, expected) {
      this.beforeUpdate?.();
      if (this.honorIfMatch && expected !== String(this.rev)) { this.rejected++; const e = new Error('412'); e.status = 412; throw e; }
      this.content = c; this.rev++; this.uploads++;
      this.afterUpdate?.();
    },
  };
}

test('engine: creates, merges, skips identical upload, re-merges on race, refuses unreadable', async () => {
  const d = fakeDrive();
  const first = await syncOnce(d, doc([], [item('a', 'phone', 0, 'phone')]), null, 'phone', () => T0);
  assert.equal(first.status, 'synced');
  assert.equal(d.uploads, 1);
  const again = await syncOnce(d, first.merged, first.merged, 'phone', () => T0);
  assert.equal(again.uploaded, false);
  let raced = false;
  d.beforeVersion = () => { if (!raced) { raced = true; d.content = JSON.stringify(doc([], [item('t', 'tablet', 0, 'tablet')])); d.rev = 9; } };
  await syncOnce(d, doc([], [item('p', 'pc', 0, 'pc')]), null, 'pc', () => T0);
  const final = JSON.parse(d.content);
  assert.ok(final.backlog.some((b) => b.text === 'tablet') && final.backlog.some((b) => b.text === 'pc'));
  const bad = fakeDrive('{"format":"soaringhigh5-sync","version":99}');
  assert.equal((await syncOnce(bad, doc(), null, 'pc')).status, 'failed');
  const denied = { find: async () => { const e = new Error('x'); e.status = 401; throw e; } };
  assert.equal((await syncOnce(denied, doc(), null, 'pc')).status, 'authFailed');
});

const texts = (d) => JSON.parse(d.content).backlog.map((b) => b.text).sort();

test('engine: 412 on update re-reads, re-merges and keeps everything', async () => {
  const d = fakeDrive(JSON.stringify(doc([], [item('phone', 'phone', 0, 'phone')])));
  d.honorIfMatch = true;
  let raced = false;
  d.beforeUpdate = () => {
    if (raced) return;
    raced = true;
    const other = JSON.parse(d.content);
    other.backlog.push(item('tablet', 'tablet', 0, 'tablet'));
    d.content = JSON.stringify(other);
    d.rev = 5;
  };
  const r = await syncOnce(d, doc([], [item('pc', 'pc', 0, 'pc')]), null, 'pc', () => T0);
  assert.equal(r.status, 'synced');
  assert.equal(d.rejected, 1);
  assert.equal(d.uploads, 1);
  assert.deepEqual(texts(d), ['pc', 'phone', 'tablet']);
});

test('engine: Drive ignoring If-Match is caught by the post-upload check', async () => {
  const d = fakeDrive(JSON.stringify(doc([], [item('phone', 'phone', 0, 'phone')])));
  let overwritten = false;
  d.afterUpdate = () => {
    if (overwritten) return;
    overwritten = true;
    d.content = JSON.stringify(doc([], [item('phone', 'phone', 0, 'phone'), item('tablet', 'tablet', 0, 'tablet')]));
    d.rev++;
  };
  const r = await syncOnce(d, doc([], [item('pc', 'pc', 0, 'pc')]), null, 'pc', () => T0);
  assert.equal(r.status, 'synced');
  assert.equal(d.uploads, 2);
  assert.deepEqual(texts(d), ['pc', 'phone', 'tablet']);
});

test('engine: remote changing on every attempt gives busy and overwrites nothing', async () => {
  const d = fakeDrive(JSON.stringify(doc([], [item('phone', 'phone', 0, 'phone')])));
  d.honorIfMatch = true;
  d.beforeUpdate = () => { d.rev++; };
  const r = await syncOnce(d, doc([], [item('pc', 'pc', 0, 'pc')]), null, 'pc', () => T0);
  assert.equal(r.status, 'busy');
  assert.deepEqual(texts(d), ['phone']);
});
