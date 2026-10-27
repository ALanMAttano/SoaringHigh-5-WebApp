import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, parseDocument, sameContent, stamp, toPlanner } from '../merge.js';
import { addBacklog, emptyPlanner, formatDue, sendToToday, addToSlot, completeBacklog, reopenBacklog, updateBacklog } from '../planner.js';

const T0 = Date.parse('2026-10-15T12:00:00.000Z');
const TODAY = '2026-10-15';
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const item = (id, text, minutes, device, extra = {}) => ({ id, text, category: 0, urgency: 'normal', status: 'open', categoryOrder: 0, urgencyOrder: 0, updatedAt: at(minutes), deviceId: device, deleted: false, ...extra });
const task = (id, text, minutes, device, extra = {}) => ({ id, text, slot: 0, status: 'pending', urgency: 'normal', date: TODAY, backlogId: null, updatedAt: at(minutes), deviceId: device, deleted: false, ...extra });
const doc = (slotTasks = [], backlog = []) => ({ format: 'soaringhigh5-sync', version: 1, slotTasks, backlog, conflicts: [], slotOrder: null, categoryNames: null, lastRolloverDate: null });

test('dueDate survives parse → toPlanner → stamp unchanged', () => {
  const remote = doc([task('t', 'a', 0, 'pc', { dueDate: '2026-11-03' })], [item('i', 'b', 0, 'pc', { dueDate: '2026-11-04' })]);
  const parsed = parseDocument(JSON.stringify(remote));
  const planner = toPlanner(parsed, TODAY);
  assert.equal(planner.slotTasks[0].dueDate, '2026-11-03');
  assert.equal(planner.backlog[0].dueDate, '2026-11-04');
  const back = stamp(planner, parsed, T0 + 60000, 'phone');
  assert.equal(back.slotTasks[0].dueDate, '2026-11-03');
  assert.equal(back.backlog[0].dueDate, '2026-11-04');
  assert.equal(back.backlog[0].deviceId, 'pc', 'an untouched item keeps its stamp');
});

test('a phone edit of text keeps the desktop dueDate', () => {
  const p = emptyPlanner();
  p.backlog.push({ id: 'i', text: 'old', category: 0, urgency: 'normal', status: 'open', categoryOrder: 0, urgencyOrder: 0, dueDate: '2026-11-04' });
  updateBacklog(p, 'i', 'new text', 0, 'normal', TODAY);
  assert.equal(p.backlog[0].dueDate, '2026-11-04');
  assert.equal(p.backlog[0].text, 'new text');
});

test('changing only dueDate counts as a change (restamped) and merge keeps the newer date', () => {
  assert.equal(sameContent(doc([], [item('a', 'x', 0, 'pc', { dueDate: '2026-11-04' })]), doc([], [item('a', 'x', 0, 'pc')])), false);
  const m = merge(doc([], [item('a', 'x', 1, 'pc', { dueDate: '2026-11-09' })]), doc([], [item('a', 'x', 0, 'phone', { dueDate: '2026-11-04' })]), null, T0 + 120000, 'pc');
  assert.equal(m.backlog[0].dueDate, '2026-11-09');
});

test('merge: a document without dueDate stays without it', () => {
  const m = merge(doc([], [item('a', 'x', 0, 'pc')]), doc([], [item('a', 'x', 0, 'pc')]), null, T0 + 120000, 'pc');
  assert.equal('dueDate' in m.backlog[0], false);
});

test('slot clash loser returns to TODO with its dueDate', () => {
  const m = merge(doc([task('a', 'mine', 1, 'pc', { dueDate: '2026-11-04' })]), doc([task('b', 'theirs', 2, 'phone')]), null, T0 + 120000, 'pc');
  const returned = m.backlog.find((b) => b.id === 'a' && !b.deleted);
  assert.equal(returned?.dueDate, '2026-11-04');
});

test('sendToToday moves the dueDate onto the slot task and a swap returns it to TODO', () => {
  const p = emptyPlanner();
  addToSlot(p, 0, 'weak', 'low', TODAY);
  p.slotTasks[0].dueDate = '2026-10-20';
  addBacklog(p, 'strong', 0, 'urgent');
  p.backlog[0].dueDate = '2026-10-15';
  const result = sendToToday(p, p.backlog[0].id, TODAY);
  assert.equal(result.result, 'swapped');
  assert.equal(p.slotTasks.at(-1).dueDate, '2026-10-15');
  assert.equal(p.backlog.find((b) => b.text === 'weak').dueDate, '2026-10-20');
});

test('completing and reopening an item keeps its dueDate', () => {
  const p = emptyPlanner();
  addBacklog(p, 'job', 1, 'normal');
  p.backlog[0].dueDate = '2026-12-01';
  completeBacklog(p, p.backlog[0].id, TODAY);
  reopenBacklog(p, p.backlog[0].id, TODAY);
  assert.equal(p.backlog[0].dueDate, '2026-12-01');
});

test('formatDue: a short local label for a valid date, empty for anything else', () => {
  assert.match(formatDue('2026-11-03', 'en'), /Nov/);
  assert.match(formatDue('2026-11-03', 'en'), /3/);
  for (const bad of [undefined, null, '', 'tomorrow', '2026-13-45x', '<img src=x>', '2026-1-3'])
    assert.equal(formatDue(bad, 'en'), '', String(bad));
});
