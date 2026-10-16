// Wish #7/#8 parity: the same fixtures are replayed by tests/SoaringHigh5.Core.Tests/TodayParityTests.cs, so the
// phone and the desktop auto-fill, move and displace identically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentInSlot, deleteSlotTask, sendToToday, setSlotStatus } from '../planner.js';

const { day, cases } = JSON.parse(readFileSync(new URL('./today-fixtures.json', import.meta.url)));

function run(p, op) {
  switch (op.kind) {
    case 'done': return String(setSlotStatus(p, op.id, 'done'));
    case 'cancel': return String(setSlotStatus(p, op.id, 'cancelled'));
    case 'delete': return String(deleteSlotTask(p, op.id, day));
    default: { const r = sendToToday(p, op.id, day); return `${r.result}@${r.slot}`; }
  }
}

for (const c of cases) {
  test(`parity: ${c.name}`, () => {
    const p = structuredClone(c.planner);
    const result = run(p, c.op);
    const slots = [0, 1, 2, 3, 4].map((s) => { const t = currentInSlot(p, s, day); return t ? `${t.id}:${t.status}` : null; });
    const backlog = p.backlog.map((b) => `${b.id}:${b.category}:${b.urgency}:${b.status}`);
    assert.deepEqual({ result, slots, backlog }, c.expect);
  });
}
