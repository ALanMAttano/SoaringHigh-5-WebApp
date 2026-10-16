import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropIndex } from '../reorder.js';

const mids = [25, 75, 125, 175, 225]; // five 50px rows

test('dropIndex: released above/below other rows gives the final row', () => {
  assert.equal(dropIndex(mids, 0, 10), 0);
  assert.equal(dropIndex(mids, 0, 130), 2);
  assert.equal(dropIndex(mids, 0, 999), 4);
  assert.equal(dropIndex(mids, 4, -50), 0);
  assert.equal(dropIndex(mids, 3, 100), 2);
  assert.equal(dropIndex(mids, 2, 125), 2); // let go where it started
});
