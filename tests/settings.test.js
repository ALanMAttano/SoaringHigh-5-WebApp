import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge, stamp } from '../merge.js';
import { emptyPlanner } from '../planner.js';
import {
  SETTINGS_KEY, adoptSyncedCategoryNames, categoryColor, categoryNamesForSync, defaultSettings, loadSettings,
  normalizeCategoryNames, normalizeSettings, renameCategory, saveSettings, setCategoryColor,
} from '../settings.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

test('defaults: follow the phone language, desktop default tuning, default names and colours', () => {
  assert.deepEqual(defaultSettings(), { language: null, hue: 0, saturation: 100, categoryNames: null, categoryColors: [null, null, null, null, null] });
  assert.equal(categoryColor(defaultSettings(), 1), '#FF4FD8');
});

test('settings persist and load back; bad values are clamped or dropped', () => {
  const storage = memoryStorage();
  let s = { ...defaultSettings(), language: 'it', hue: 45, saturation: 60 };
  s = setCategoryColor(renameCategory(s, 2, '  Hogar  '), 4, '#12ab34');
  saveSettings(storage, s);
  assert.deepEqual(loadSettings(storage), { language: 'it', hue: 45, saturation: 60,
    categoryNames: [null, null, 'Hogar', null, null], categoryColors: [null, null, null, null, '#12AB34'] });
  storage.setItem(SETTINGS_KEY, JSON.stringify({ language: 'de', hue: 999, saturation: 1, categoryColors: ['red', 5] }));
  assert.deepEqual(loadSettings(storage), { ...defaultSettings(), hue: 180, saturation: 35 });
  storage.setItem(SETTINGS_KEY, '{not json');
  assert.deepEqual(loadSettings(storage), defaultSettings());
});

test('the old header language is carried over once and the old key removed', () => {
  const storage = memoryStorage({ 'sh5.lang': 'en' });
  const s = loadSettings(storage);
  assert.equal(s.language, 'en');
  saveSettings(storage, s);
  assert.equal(storage.getItem('sh5.lang'), null);
});

test('category names normalize like the desktop (5 entries, trimmed, one line, 24 chars, blank = default)', () => {
  assert.deepEqual(normalizeCategoryNames([' a ', '', 'x\ny', 'z'.repeat(30)]), ['a', null, 'x y', 'z'.repeat(24), null]);
  assert.deepEqual(normalizeSettings({ categoryNames: ['A'] }).categoryNames, ['A', null, null, null, null]);
});

const T = Date.parse('2026-10-16T12:00:00Z');

test('category rename on the phone syncs to the desktop register', () => {
  const desktop = merge(stamp(emptyPlanner(), null, T, 'pc', ['Plata', null, null, null, null]), null, null, T, 'pc');
  let phone = adoptSyncedCategoryNames(defaultSettings(), desktop);
  assert.deepEqual(phone.categoryNames, ['Plata', null, null, null, null]);
  phone = renameCategory(phone, 2, 'Hogar');
  const phoneDoc = stamp(emptyPlanner(), desktop, T + 60000, 'phone', categoryNamesForSync(phone));
  const merged = merge(phoneDoc, desktop, desktop, T + 61000, 'phone');
  assert.deepEqual(merged.categoryNames.value, ['Plata', null, 'Hogar', null, null]);
  assert.equal(merged.categoryNames.deviceId, 'phone');
});

test('an untouched phone never overwrites the desktop names; unchanged names keep their stamp', () => {
  const desktop = merge(stamp(emptyPlanner(), null, T, 'pc', ['Plata', null, null, null, null]), null, null, T, 'pc');
  const fresh = defaultSettings();
  const first = merge(stamp(emptyPlanner(), null, T + 60000, 'phone', categoryNamesForSync(fresh)), desktop, null, T + 61000, 'phone');
  assert.deepEqual(first.categoryNames.value, ['Plata', null, null, null, null]);
  const adopted = adoptSyncedCategoryNames(fresh, first);
  const again = stamp(emptyPlanner(), first, T + 120000, 'phone', categoryNamesForSync(adopted));
  assert.equal(again.categoryNames.updatedAt, first.categoryNames.updatedAt);
});

test('category colours are local only: never in the sync document', () => {
  const s = setCategoryColor(defaultSettings(), 0, '#FFFFFF');
  const doc = stamp(emptyPlanner(), null, T, 'phone', categoryNamesForSync(s));
  assert.ok(!JSON.stringify(doc).includes('FFFFFF'));
});
