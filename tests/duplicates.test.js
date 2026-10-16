import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, stamp, toPlanner } from '../merge.js';
import { addToSlot, emptyPlanner, ensureRollover, setSlotStatus } from '../planner.js';

const YESTERDAY = '2026-10-15';
const TODAY = '2026-10-16';
const t = (iso) => Date.parse(iso);
const copies = (p, text) => p.backlog.filter((b) => b.text === text).length + p.slotTasks.filter((s) => s.text === text).length;
const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

test('returned task keeps its id as the TODO item id', () => {
  const p = { ...emptyPlanner(), lastRolloverDate: '2026-10-14', slotTasks: [
    { id: 'older', date: '2026-10-14', slot: 0, text: 'older', urgency: 'normal', status: 'pending' },
    { id: 'newer', date: YESTERDAY, slot: 0, text: 'newer', urgency: 'normal', status: 'pending' }] };
  ensureRollover(p, TODAY);
  assert.deepEqual(p.backlog.map((b) => b.id), ['older']);
});

test('rollover on one device + carry-over on the other leaves one copy', () => {
  const a = emptyPlanner();
  ensureRollover(a, YESTERDAY);
  addToSlot(a, 0, 'T', 'normal', YESTERDAY, id);
  const shared = merge(stamp(a, null, t('2026-10-16T02:50:00Z'), 'a'), null, null, t('2026-10-16T02:50:00Z'), 'a');
  const b = emptyPlanner();
  ensureRollover(b, TODAY);
  addToSlot(b, 0, 'B today', 'normal', TODAY, id);
  const bMerged = merge(stamp(b, null, t('2026-10-16T11:00:00Z'), 'b'), shared, null, t('2026-10-16T11:00:00Z'), 'b');
  const bAfter = toPlanner(bMerged, TODAY);
  assert.equal(ensureRollover(bAfter, TODAY).returned, 1);
  const bDoc = stamp(bAfter, bMerged, t('2026-10-16T11:01:00Z'), 'b');
  const a2 = toPlanner(clone(shared), YESTERDAY);
  ensureRollover(a2, TODAY);
  const aDoc = stamp(a2, shared, t('2026-10-16T11:05:00Z'), 'a');
  const final = toPlanner(merge(aDoc, bDoc, shared, t('2026-10-16T11:06:00Z'), 'a'), TODAY);
  assert.equal(copies(final, 'T'), 1);
  assert.equal(copies(final, 'B today'), 1);
});

test('two offline devices returning the same task give exactly one TODO item', () => {
  const start = { ...emptyPlanner(), lastRolloverDate: '2026-10-14', slotTasks: [
    { id: id(), date: '2026-10-14', slot: 0, text: 'older', urgency: 'normal', status: 'pending', backlogId: null },
    { id: id(), date: YESTERDAY, slot: 0, text: 'newer', urgency: 'normal', status: 'pending', backlogId: null }] };
  const shared = merge(stamp(start, null, t('2026-10-15T12:00:00Z'), 'a'), null, null, t('2026-10-15T12:00:00Z'), 'a');
  const offline = (device, iso) => {
    const p = toPlanner(clone(shared), YESTERDAY);
    ensureRollover(p, TODAY);
    return stamp(p, shared, t(iso), device);
  };
  const final = toPlanner(merge(offline('a', '2026-10-16T11:01:00Z'), offline('b', '2026-10-16T11:02:00Z'), shared, t('2026-10-16T11:03:00Z'), 'a'), TODAY);
  assert.deepEqual(final.backlog.map((b) => b.text), ['older']);
  assert.deepEqual(final.slotTasks.map((s) => s.text), ['newer']);
});

test('same text re-added to a slot gets a new id; both survive', () => {
  const p = { ...emptyPlanner(), lastRolloverDate: '2026-10-14', slotTasks: [
    { id: 'orig', date: '2026-10-14', slot: 0, text: 'T', urgency: 'normal', status: 'pending' },
    { id: 'newer', date: YESTERDAY, slot: 0, text: 'newer', urgency: 'normal', status: 'pending' }] };
  ensureRollover(p, TODAY);
  setSlotStatus(p, 'newer', 'done');
  assert.equal(addToSlot(p, 0, 'T', 'normal', TODAY, id), 'added');
  const again = p.slotTasks.find((s) => s.text === 'T');
  assert.notEqual(again.id, 'orig');
  const data = toPlanner(merge(stamp(p, null, t('2026-10-16T12:00:00Z'), 'a'), null, null, t('2026-10-16T12:00:00Z'), 'a'), TODAY);
  assert.deepEqual(data.backlog.map((b) => b.id), ['orig']);
  assert.equal(data.slotTasks.find((s) => s.text === 'T').id, again.id);
});

test('legacy duplicate open items collapse to the newest and are logged', () => {
  const item = (iid, minutes, extra = {}) => ({ id: iid, text: 'Call mum', category: 1, urgency: 'normal', status: 'open', categoryOrder: 0, urgencyOrder: 0,
    updatedAt: new Date(t('2026-10-16T12:00:00Z') + minutes * 60000).toISOString(), deviceId: 'pc', deleted: false, ...extra });
  const doc = { format: 'soaringhigh5-sync', version: 1, conflicts: [], slotOrder: null, categoryNames: null, lastRolloverDate: null,
    backlog: [item('old', 0), item('new', 1), item('cat2', 0, { category: 2 }), item('done', 0, { status: 'done' })],
    slotTasks: [{ id: 'task', date: TODAY, slot: 1, text: 'Call mum', urgency: 'normal', status: 'pending', backlogId: 'old', updatedAt: '2026-10-16T12:00:00.000Z', deviceId: 'pc', deleted: false }] };
  const merged = merge(doc, null, null, t('2026-10-16T12:02:00Z'), 'pc');
  const data = toPlanner(merged, TODAY);
  assert.deepEqual(data.backlog.map((b) => b.id).sort(), ['cat2', 'done', 'new']);
  assert.equal(data.slotTasks[0].backlogId, 'new');
  assert.ok(merged.conflicts.some((c) => c.kind === 'dedup' && c.id === 'old'));
});
