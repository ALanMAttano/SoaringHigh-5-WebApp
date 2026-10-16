import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_TUNING, HUE_MAX, HUE_MIN, MIN_READABLE_LUMINANCE, SATURATION_MAX, SATURATION_MIN, TUNED_THEME, applyTuning, clampTuning, luma, tunedTheme } from '../color.js';

const fixtures = JSON.parse(readFileSync(new URL('./color-fixtures.json', import.meta.url))).cases;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('ranges and clamping match ColorTuning.cs (−180…180°, 35…100 %)', () => {
  assert.deepEqual([HUE_MIN, HUE_MAX, SATURATION_MIN, SATURATION_MAX], [-180, 180, 35, 100]);
  assert.deepEqual(clampTuning(-999, 0), { hue: -180, saturation: 35 });
  assert.deepEqual(clampTuning(999, 999), { hue: 180, saturation: 100 });
  assert.deepEqual(clampTuning(40, 70), { hue: 40, saturation: 70 });
  assert.deepEqual(clampTuning('x', undefined), DEFAULT_TUNING);
});

test('same colours as the desktop for the shared fixtures (C# checks the same file)', () => {
  assert.ok(fixtures.length > 50);
  for (const c of fixtures) assert.equal(applyTuning(c.color, { hue: c.hue, saturation: c.saturation }), c.expected, JSON.stringify(c));
});

test('default tuning leaves colours alone; every hue keeps the neon text readable', () => {
  assert.deepEqual(tunedTheme(DEFAULT_TUNING), TUNED_THEME);
  for (const hue of [-180, -120, -60, 60, 120, 180])
    for (const saturation of [35, 70, 100])
      assert.ok(luma(rgb(applyTuning('#00FF41', { hue, saturation }))) >= MIN_READABLE_LUMINANCE - 0.01);
});
