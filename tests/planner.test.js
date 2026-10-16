import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, stamp, toPlanner } from '../merge.js';
import {
  addBacklog, addToFreeSlot, addToSlot, backlogByCategory, backlogByUrgency, completeBacklog, openBacklog, deleteBacklog, deleteSlotTask, emptyPlanner, freeSlots,
  currentInSlot, displaySlots, outranks, reorderWithinUrgency, sendToToday, setSlotStatus, updateBacklog, updateSlotTask,
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

test('-> HOY into a busy own slot: a more urgent item swaps; the displaced task returns to TODO', () => {
  const p = emptyPlanner();
  addToSlot(p, 3, 'busy', 'normal', DAY, () => 't0');
  addBacklog(p, 'gym', 3, 'urgent', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'swapped', slot: 3 });
  assert.equal(currentInSlot(p, 3, DAY).id, 'item');
  assert.deepEqual(p.backlog.map((b) => [b.id, b.category, b.urgency, b.status]), [['t0', 3, 'normal', 'open']]);
});

test('-> HOY tie: the older task (already in the slot) goes back to TODO', () => {
  const p = emptyPlanner();
  addToSlot(p, 1, 'busy', 'important', DAY, () => 't0');
  addBacklog(p, 'new', 1, 'important', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'swapped', slot: 1 });
  assert.deepEqual(p.backlog.map((b) => b.id), ['t0']);
});

test('-> HOY less important than the current task: stays in TODO, nothing changes; other free slots are not used', () => {
  const p = emptyPlanner();
  addToSlot(p, 2, 'busy', 'urgent', DAY, () => 't0');
  addBacklog(p, 'later', 2, 'wish', () => 'item');
  const before = JSON.stringify(p);
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'outranked', slot: 2 });
  assert.equal(JSON.stringify(p), before);
});

test('outranks: incoming wins when at least as urgent', () => {
  assert.ok(outranks('urgent', 'normal'));
  assert.ok(outranks('normal', 'normal'));
  assert.equal(outranks('wish', 'important'), false);
});

test('sendToToday refusals', () => {
  const p = emptyPlanner();
  addBacklog(p, 'x', 0, 'normal', () => 'item');
  assert.deepEqual(sendToToday(p, 'nope', DAY), { result: 'notFound' });
  legacyLink(p, 'item', 0);
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'alreadyThere' });
  completeBacklog(p, 'item', DAY);
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'notOpen' });
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

test('auto-fill: a deleted task pulls the most urgent open item of that category; done keeps the task', () => {
  const p = emptyPlanner();
  addToSlot(p, 1, 'today', 'normal', DAY, () => 'task');
  const id = ids();
  addBacklog(p, 'normal', 1, 'normal', id);
  addBacklog(p, 'urgent', 1, 'urgent', id);
  addBacklog(p, 'elsewhere', 2, 'urgentImportant', id);
  setSlotStatus(p, 'task', 'done', DAY);
  assert.equal(currentInSlot(p, 1, DAY).id, 'task'); // done stays, UNDO works
  setSlotStatus(p, 'task', 'pending');
  assert.equal(currentInSlot(p, 1, DAY).status, 'pending');
  deleteSlotTask(p, 'task', DAY);
  assert.equal(currentInSlot(p, 1, DAY).text, 'urgent');
  deleteSlotTask(p, 'id-2', DAY);
  assert.equal(currentInSlot(p, 1, DAY).text, 'normal');
  deleteSlotTask(p, 'id-1', DAY);
  assert.equal(currentInSlot(p, 1, DAY), null);
  assert.deepEqual(p.backlog.map((b) => b.text), ['elsewhere']);
});

/** Slots 0..4 with urgencies; null = empty slot. */
function withUrgencies(urgencies) {
  const p = emptyPlanner();
  urgencies.forEach((u, slot) => { if (u) addToSlot(p, slot, `t${slot}`, u, DAY, () => `t${slot}`); });
  return p;
}

test('HOY display: most urgent first, ties in saved order, empty last, done keeps its urgency place', () => {
  const p = withUrgencies(['normal', 'urgent', null, 'normal', 'urgentImportant']);
  assert.deepEqual(displaySlots(p, DAY), [4, 1, 0, 3, 2]);
  setSlotStatus(p, 't4', 'done');
  assert.deepEqual(displaySlots(p, DAY), [4, 1, 0, 3, 2]);
  p.slotOrder = [3, 2, 1, 0, 4];
  assert.deepEqual(displaySlots(p, DAY), [4, 1, 3, 0, 2]);
});

test('HOY display sort leaves the data alone', () => {
  const p = withUrgencies(['wish', 'urgent', 'normal', null, null]);
  const before = JSON.stringify(p);
  displaySlots(p, DAY);
  assert.equal(JSON.stringify(p), before);
});

test('HOY reorder: only among the same urgency; the group keeps its positions in the saved order', () => {
  const p = withUrgencies(['normal', 'urgent', 'normal', 'normal', 'wish']);
  assert.deepEqual(displaySlots(p, DAY), [1, 0, 2, 3, 4]);
  assert.equal(reorderWithinUrgency(p, DAY, 3, 1), 'moved'); // slot 3 above slot 0
  assert.deepEqual(displaySlots(p, DAY), [1, 3, 0, 2, 4]);
  assert.deepEqual(p.slotOrder, [3, 1, 0, 2, 4]); // urgent (1) and wish (4) kept their places
  assert.equal(reorderWithinUrgency(p, DAY, 1, 3), 'moved'); // and back down to the end of its group
  assert.deepEqual(displaySlots(p, DAY), [1, 0, 2, 3, 4]);
  const before = JSON.stringify(p);
  assert.equal(reorderWithinUrgency(p, DAY, 0, 2), 'otherUrgency');
  assert.equal(reorderWithinUrgency(p, DAY, 4, 3), 'otherUrgency');
  assert.equal(reorderWithinUrgency(p, DAY, 2, 2), 'unchanged');
  assert.equal(JSON.stringify(p), before);
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
