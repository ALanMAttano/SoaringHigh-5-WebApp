import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, stamp, toPlanner } from '../merge.js';
import {
  addBacklog, addToFreeSlot, addToSlot, backlogByCategory, backlogByUrgency, completeBacklog, openBacklog, deleteBacklog, deleteSlotTask, emptyPlanner, freeSlots,
  currentInSlot, moveSlotRow, moveToSlot, sendToToday, setSlotStatus, updateBacklog, updateSlotTask,
} from '../planner.js';

const DAY = '2026-10-16';
const ids = () => { let n = 0; return () => `id-${++n}`; };

function fullDay() {
  const p = emptyPlanner();
  const id = ids();
  for (let slot = 0; slot < 5; slot++) addToSlot(p, slot, `task ${slot}`, 'normal', DAY, id);
  return p;
}

test('add into a free slot; a busy slot refuses; the 5-task limit holds', () => {
  const p = fullDay();
  assert.equal(p.slotTasks.length, 5);
  assert.deepEqual(freeSlots(p, DAY), []);
  assert.equal(addToSlot(p, 2, 'sixth', 'normal', DAY), 'slotBusy');
  assert.equal(p.slotTasks.length, 5);
  assert.equal(addToSlot(p, 1, '   ', 'normal', DAY), 'empty');
});

test('edit a task: text and urgency, id/status/date kept', () => {
  const p = emptyPlanner();
  addToSlot(p, 0, 'call bank', 'normal', DAY, () => 'a');
  assert.equal(updateSlotTask(p, 'a', '  call the bank ', 'urgent', 0), 'updated');
  assert.deepEqual(p.slotTasks[0], { id: 'a', date: DAY, slot: 0, text: 'call the bank', urgency: 'urgent', status: 'pending', backlogId: null });
  assert.equal(updateSlotTask(p, 'a', '', 'urgent', 0), 'empty');
  assert.equal(updateSlotTask(p, 'zz', 'x', 'urgent', 0), 'notFound');
});

test('edit a task category moves it to that slot only when it is free', () => {
  const p = emptyPlanner();
  const id = ids();
  addToSlot(p, 0, 'a', 'normal', DAY, id);
  addToSlot(p, 1, 'b', 'normal', DAY, id);
  assert.equal(updateSlotTask(p, 'id-1', 'a', 'normal', 1), 'slotBusy');
  assert.equal(p.slotTasks.find((t) => t.id === 'id-1').slot, 0);
  setSlotStatus(p, 'id-2', 'done', DAY);
  assert.equal(updateSlotTask(p, 'id-1', 'a', 'normal', 1), 'updated'); // the finished task there is replaced
  assert.deepEqual(p.slotTasks.map((t) => [t.id, t.slot]), [['id-1', 1]]);
  assert.deepEqual(freeSlots(p, DAY), [0, 2, 3, 4]);
});

/** A daily task linked to a TODO item, as v2.31 and older made them (the item stayed in the list). */
function legacyLink(p, itemId, slot, taskId = 'task') {
  const item = p.backlog.find((b) => b.id === itemId);
  p.slotTasks.push({ id: taskId, date: DAY, slot, text: item.text, urgency: item.urgency, status: 'pending', backlogId: itemId });
}

test('legacy linked task: editing it updates the linked item too', () => {
  const p = emptyPlanner();
  addBacklog(p, 'plan trip', 1, 'normal', () => 'item');
  legacyLink(p, 'item', 1);
  updateSlotTask(p, 'task', 'plan the trip', 'important', 3);
  assert.deepEqual([p.backlog[0].text, p.backlog[0].urgency, p.backlog[0].category], ['plan the trip', 'important', 3]);
});

test('TODO grouped by urgency, most urgent first, saved order inside a group, open items only', () => {
  const p = emptyPlanner();
  const id = ids();
  addBacklog(p, 'w', 0, 'wish', id);
  addBacklog(p, 'n1', 1, 'normal', id);
  addBacklog(p, 'ui', 2, 'urgentImportant', id);
  addBacklog(p, 'n2', 0, 'normal', id);
  addBacklog(p, 'gone', 0, 'urgent', id);
  p.backlog.find((b) => b.text === 'gone').status = 'done';
  assert.deepEqual(backlogByUrgency(p).map((g) => [g.urgency, g.items.map((b) => b.text)]),
    [['urgentImportant', ['ui']], ['normal', ['n1', 'n2']], ['wish', ['w']]]);
});

test('legacy linked task: editing the TODO item updates it; done/undo/cancel follow desktop rules', () => {
  const p = emptyPlanner();
  addBacklog(p, 'b', 0, 'normal', () => 'item');
  legacyLink(p, 'item', 0);
  assert.equal(updateBacklog(p, 'item', 'b!', 0, 'urgent', DAY), 'updated');
  assert.deepEqual([p.slotTasks[0].text, p.slotTasks[0].urgency], ['b!', 'urgent']);
  setSlotStatus(p, 'task', 'done', DAY);
  assert.equal(p.backlog[0].status, 'done');
  setSlotStatus(p, 'task', 'pending', DAY);
  assert.equal(p.backlog[0].status, 'open');
  setSlotStatus(p, 'task', 'cancelled', DAY);
  assert.equal(p.backlog[0].status, 'open');
  assert.ok(completeBacklog(p, 'item', DAY));
});

test('deleting a TODO item unlinks a legacy daily task', () => {
  const p = emptyPlanner();
  addBacklog(p, 'x', 0, 'normal', () => 'item');
  legacyLink(p, 'item', 0);
  assert.ok(deleteBacklog(p, 'item'));
  assert.equal(p.slotTasks[0].backlogId, null);
});

test('-> HOY moves the item out of TODO into its own slot, keeping its id', () => {
  const p = emptyPlanner();
  addBacklog(p, 'gym', 3, 'important', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'moved', slot: 3 });
  assert.deepEqual(p.backlog, []);
  assert.deepEqual(p.slotTasks[0], { id: 'item', date: DAY, slot: 3, text: 'gym', urgency: 'important', status: 'pending', backlogId: null });
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'notFound' });
});

test('-> HOY with its slot busy uses the first free slot', () => {
  const p = emptyPlanner();
  addToSlot(p, 3, 'busy', 'normal', DAY, () => 't0');
  addBacklog(p, 'gym', 3, 'normal', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'moved', slot: 0 });
});

test('-> HOY with all five busy swaps with its own slot; the displaced task returns to TODO', () => {
  const p = fullDay();
  addBacklog(p, 'extra', 2, 'urgent', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'swapped', slot: 2 });
  assert.equal(currentInSlot(p, 2, DAY).id, 'item');
  assert.deepEqual(p.backlog.map((b) => [b.id, b.category, b.urgency, b.status]), [['id-3', 2, 'normal', 'open']]);
  assert.equal(p.slotTasks.length, 5);
});

test('moveToSlot refusals', () => {
  const p = emptyPlanner();
  addBacklog(p, 'x', 0, 'normal', () => 'item');
  assert.equal(moveToSlot(p, 'item', 7, DAY), 'invalidSlot');
  assert.equal(moveToSlot(p, 'nope', 0, DAY), 'notFound');
  legacyLink(p, 'item', 0);
  assert.equal(moveToSlot(p, 'item', 0, DAY), 'alreadyThere');
  completeBacklog(p, 'item', DAY);
  assert.equal(moveToSlot(p, 'item', 1, DAY), 'notOpen');
});

test('a moved TODO item syncs as one task and a tombstoned item, never a duplicate', () => {
  const T = Date.parse('2026-10-16T12:00:00Z');
  const p = emptyPlanner();
  addBacklog(p, 'gym', 0, 'normal', () => 'item');
  const shared = merge(stamp(p, null, T, 'pc'), null, null, T, 'pc');
  const phone = toPlanner(structuredClone(shared), DAY);
  sendToToday(phone, 'item', DAY);
  const phoneDoc = stamp(phone, shared, T + 60000, 'phone');
  const final = toPlanner(merge(shared, phoneDoc, shared, T + 120000, 'pc'), DAY);
  assert.deepEqual(final.backlog, []);
  assert.deepEqual(final.slotTasks.map((t) => [t.id, t.text]), [['item', 'gym']]);
});

test('auto-fill: done or deleted task pulls the most urgent open item of that category', () => {
  const p = emptyPlanner();
  addToSlot(p, 1, 'today', 'normal', DAY, () => 'task');
  const id = ids();
  addBacklog(p, 'normal', 1, 'normal', id);
  addBacklog(p, 'urgent', 1, 'urgent', id);
  addBacklog(p, 'elsewhere', 2, 'urgentImportant', id);
  setSlotStatus(p, 'task', 'done', DAY);
  assert.equal(currentInSlot(p, 1, DAY).text, 'urgent');
  deleteSlotTask(p, 'id-2', DAY);
  assert.equal(currentInSlot(p, 1, DAY).text, 'normal');
  deleteSlotTask(p, 'id-1', DAY);
  assert.equal(currentInSlot(p, 1, DAY), null);
  assert.deepEqual(p.backlog.map((b) => b.text), ['elsewhere']);
});

test('HOY reorder: moveSlotRow moves a slot to a row (clamped), false when unchanged', () => {
  const p = emptyPlanner();
  assert.ok(moveSlotRow(p, 0, 9));
  assert.deepEqual(p.slotOrder, [1, 2, 3, 4, 0]);
  assert.equal(moveSlotRow(p, 0, 4), false);
  assert.ok(moveSlotRow(p, 3, 0));
  assert.deepEqual(p.slotOrder, [3, 1, 2, 4, 0]);
});

test('TODO tab: all open items in creation order, whatever their urgency or category', () => {
  const p = emptyPlanner();
  const id = ids();
  addBacklog(p, 'first', 3, 'wish', id);
  addBacklog(p, 'second', 0, 'urgentImportant', id);
  addBacklog(p, 'third', 1, 'normal', id);
  updateBacklog(p, 'id-1', 'first!', 2, 'urgent', DAY); // editing does not move it
  completeBacklog(p, 'id-3', DAY);
  assert.deepEqual(openBacklog(p).map((b) => b.text), ['first!', 'second']);
});

test('HOY add form: chosen category when free, else the first free slot, refused when all 5 are full', () => {
  const p = emptyPlanner();
  const id = ids();
  assert.deepEqual(addToFreeSlot(p, 'bank', 'urgent', DAY, 2, id), { result: 'added', slot: 2 });
  assert.deepEqual(addToFreeSlot(p, 'gym', 'normal', DAY, 2, id), { result: 'added', slot: 0 });
  assert.deepEqual(addToFreeSlot(p, '  ', 'normal', DAY, 1, id), { result: 'empty' });
  const full = fullDay();
  assert.deepEqual(addToFreeSlot(full, 'sixth', 'normal', DAY, 0), { result: 'noFreeSlot' });
  assert.equal(full.slotTasks.length, 5);
});

test('TODO tab grouped by category in slot order, saved order inside a group, open items only', () => {
  const p = emptyPlanner();
  p.slotOrder = [3, 0, 1, 2, 4];
  const id = ids();
  addBacklog(p, 'a0', 0, 'wish', id);
  addBacklog(p, 'b3', 3, 'normal', id);
  addBacklog(p, 'c0', 0, 'urgentImportant', id);
  addBacklog(p, 'gone', 1, 'normal', id);
  completeBacklog(p, 'id-4', DAY);
  assert.deepEqual(backlogByCategory(p).map((g) => [g.category, g.items.map((b) => b.text)]), [[3, ['b3']], [0, ['a0', 'c0']]]);
});
