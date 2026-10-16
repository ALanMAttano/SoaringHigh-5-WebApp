import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, pickLanguage, texts } from '../i18n.js';

test('every language has the same keys (es, en, it)', () => {
  const keys = (o) => Object.keys(o).sort();
  for (const lang of LANGUAGES) {
    assert.deepEqual(keys(texts(lang)), keys(texts('es')), lang);
    assert.deepEqual(keys(texts(lang).urgency), keys(texts('es').urgency), lang);
    assert.deepEqual(keys(texts(lang).urgencyGroup), keys(texts('es').urgency), lang);
    assert.equal(texts(lang).categories.length, 5);
  }
});

test('language pick: saved choice, else the phone language, else Spanish', () => {
  assert.equal(pickLanguage(null, ['it-IT', 'en']), 'it');
  assert.equal(pickLanguage(null, ['en-GB']), 'en');
  assert.equal(pickLanguage(null, ['de-DE']), 'es');
  assert.equal(pickLanguage('en', ['it']), 'en');
  assert.equal(pickLanguage(null, ['es-AR']), 'es');
});
