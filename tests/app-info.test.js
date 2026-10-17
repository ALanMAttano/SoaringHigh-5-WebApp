import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PWA_VERSION, RELEASES_URL } from '../app-info.js';

test('change log URL is the pinned releases page (same as the desktop UpdateSource.ReleasesPageUrl)', () => {
  assert.equal(RELEASES_URL, 'https://github.com/ALanMAttano/SoaringHigh-5/releases');
});

test('the service-worker cache name follows the PWA version (phones pick up the update)', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes(`'sh5-pwa-${PWA_VERSION}'`), 'bump CACHE in sw.js together with PWA_VERSION');
});

test('every module the app imports is in the offline app shell', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const dir = new URL('../', import.meta.url);
  const modules = ['app.js'];
  for (let i = 0; i < modules.length; i++) {
    for (const [, dep] of readFileSync(new URL(modules[i], dir), 'utf8').matchAll(/from '\.\/([\w-]+\.js)'/g))
      if (!modules.includes(dep)) modules.push(dep);
  }
  for (const m of modules) assert.ok(sw.includes(`'${m}'`), `${m} missing from SHELL in sw.js`);
});

test('the installed app follows the phone rotation (no locked portrait)', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.orientation, 'any');
});

test('TODO tab rows without a category label have a layout in portrait and landscape', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const rules = css.match(/li\.task-row\.no-cat \{[^}]*grid-template-areas:[^}]*\}/g) ?? [];
  assert.equal(rules.length, 2);
  assert.ok(rules.every((r) => !/grid-template-areas:[^;]*\bcat\b/.test(r)));
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /category = state\.view === 'todo' \? null : item\.category/);
});

test('v2.39 tap targets, neon glow and reduced-motion pulse', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.task-row \.btn \{[^}]*min-height: 44px[^}]*white-space: nowrap/);
  assert.match(css, /body\.glow-pulse [^{]*\{ animation: glow-pulse/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ body\.glow-pulse[^{]*\{ animation: none/);
  assert.match(css, /box-shadow: 0 0 6px color-mix\(in srgb, var\(--neon\)/);
});
