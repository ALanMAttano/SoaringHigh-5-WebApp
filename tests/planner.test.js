import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, stamp, toPlanner } from '../merge.js';
import {
  addBacklog, addToFreeSlot, addToSlot, backlogByCategory, backlogByUrgency, completeBacklog, openBacklog, deleteBacklog, deleteSlotTask, emptyPlanner, freeSlots,
  sendToToday, setSlotStatus, todayTaskFor, updateBacklog, updateSlotTask,
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
  setSlotStatus(p, 'id-2', 'done');
  assert.equal(updateSlotTask(p, 'id-1', 'a', 'normal', 1), 'updated'); // the finished task there is replaced
  assert.deepEqual(p.slotTasks.map((t) => [t.id, t.slot]), [['id-1', 1]]);
  assert.deepEqual(freeSlots(p, DAY), [0, 2, 3, 4]);
});

test('editing a task from the TODO list updates the linked item too', () => {
  const p = emptyPlanner();
  addBacklog(p, 'plan trip', 1, 'normal', () => 'item');
  sendToToday(p, 'item', DAY, () => 'task');
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

test('edit a TODO item: changing urgency puts it at the end of the new group; today\'s task follows', () => {
  const p = emptyPlanner();
  const id = ids();
  addBacklog(p, 'a', 0, 'urgent', id);
  addBacklog(p, 'b', 0, 'normal', id);
  sendToToday(p, 'id-2', DAY, () => 'task');
  assert.equal(updateBacklog(p, 'id-2', 'b!', 0, 'urgent', DAY), 'updated');
  assert.deepEqual(backlogByUrgency(p)[0].items.map((b) => b.text), ['a', 'b!']);
  assert.deepEqual([p.slotTasks[0].text, p.slotTasks[0].urgency], ['b!', 'urgent']);
  assert.equal(updateBacklog(p, 'id-2', ' ', 0, 'urgent', DAY), 'empty');
});

test('delete a TODO item unlinks its daily task; deleting a task keeps the item', () => {
  const p = emptyPlanner();
  addBacklog(p, 'x', 0, 'normal', () => 'item');
  sendToToday(p, 'item', DAY, () => 'task');
  assert.ok(deleteSlotTask(p, 'task'));
  assert.equal(p.backlog.length, 1);
  sendToToday(p, 'item', DAY, () => 'task2');
  assert.ok(deleteBacklog(p, 'item'));
  assert.equal(p.slotTasks[0].backlogId, null);
});

test('send TODO item to today: own category slot, keeps the item id, linked task', () => {
  const p = emptyPlanner();
  addBacklog(p, 'gym', 3, 'important', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY, () => 'task'), { result: 'sent', slot: 3 });
  assert.deepEqual(p.backlog.map((b) => [b.id, b.status]), [['item', 'open']]);
  assert.deepEqual(p.slotTasks[0], { id: 'task', date: DAY, slot: 3, text: 'gym', urgency: 'important', status: 'pending', backlogId: 'item' });
  assert.equal(todayTaskFor(p, 'item', DAY).id, 'task');
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'alreadyToday' });
});

test('send to today when its slot is busy uses the first free slot and recategorizes', () => {
  const p = emptyPlanner();
  addToSlot(p, 3, 'busy', 'normal', DAY, () => 't0');
  addBacklog(p, 'gym', 3, 'normal', () => 'item');
  assert.deepEqual(sendToToday(p, 'item', DAY, () => 'task'), { result: 'sent', slot: 0 });
  assert.equal(p.backlog[0].category, 0);
});

test('send to today with all five slots busy: clear refusal, nothing changes', () => {
  const p = fullDay();
  addBacklog(p, 'extra', 0, 'normal', () => 'item');
  const before = JSON.stringify(p);
  assert.deepEqual(sendToToday(p, 'item', DAY), { result: 'noFreeSlot' });
  assert.equal(JSON.stringify(p), before);
});

test('done closes the linked item; undo and cancel reopen it (desktop rules)', () => {
  const p = emptyPlanner();
  addBacklog(p, 'x', 0, 'normal', () => 'item');
  sendToToday(p, 'item', DAY, () => 'task');
  setSlotStatus(p, 'task', 'done');
  assert.equal(p.backlog[0].status, 'done');
  setSlotStatus(p, 'task', 'pending');
  assert.equal(p.backlog[0].status, 'open');
  setSlotStatus(p, 'task', 'cancelled');
  assert.equal(p.backlog[0].status, 'open');
});

test('a TODO item sent to today on the phone syncs as one item and one linked task', () => {
  const T = Date.parse('2026-10-16T12:00:00Z');
  const p = emptyPlanner();
  addBacklog(p, 'gym', 0, 'normal', () => 'item');
  const shared = merge(stamp(p, null, T, 'pc'), null, null, T, 'pc');
  const phone = toPlanner(structuredClone(shared), DAY);
  sendToToday(phone, 'item', DAY, () => 'task');
  updateBacklog(phone, 'item', 'gym 7pm', 0, 'normal', DAY);
  const phoneDoc = stamp(phone, shared, T + 60000, 'phone');
  assert.ok(phoneDoc.backlog[0].updatedAt > shared.backlog[0].updatedAt);
  const final = toPlanner(merge(shared, phoneDoc, shared, T + 120000, 'pc'), DAY);
  assert.deepEqual(final.backlog.map((b) => [b.id, b.text]), [['item', 'gym 7pm']]);
  assert.deepEqual(final.slotTasks.map((t) => [t.backlogId, t.text]), [['item', 'gym 7pm']]);
});

test('ticking a TODO item done closes today\'s task made from it', () => {
  const p = emptyPlanner();
  addBacklog(p, 'x', 0, 'normal', () => 'item');
  sendToToday(p, 'item', DAY, () => 'task');
  assert.ok(completeBacklog(p, 'item', DAY));
  assert.deepEqual([p.backlog[0].status, p.slotTasks[0].status], ['done', 'done']);
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
