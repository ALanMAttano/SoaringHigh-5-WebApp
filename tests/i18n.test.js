import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, LANGUAGE_ABBREVIATIONS, pickLanguage, texts } from '../i18n.js';

test('every language has the same keys (es, en, it)', () => {
  const keys = (o) => Object.keys(o).sort();
  for (const lang of LANGUAGES) {
    assert.deepEqual(keys(texts(lang)), keys(texts('es')), lang);
    assert.deepEqual(keys(texts(lang).urgency), keys(texts('es').urgency), lang);
    assert.deepEqual(keys(texts(lang).urgencyGroup), keys(texts('es').urgency), lang);
    assert.equal(texts(lang).categories.length, 5);
    assert.deepEqual(keys(texts(lang).tabs), ['today', 'todo', 'urgency'], lang);
  }
});

test('language pick: saved choice, else the phone language, else Spanish', () => {
  assert.equal(pickLanguage(null, ['it-IT', 'en']), 'it');
  assert.equal(pickLanguage(null, ['en-GB']), 'en');
  assert.equal(pickLanguage(null, ['de-DE']), 'es');
  assert.equal(pickLanguage('en', ['it']), 'en');
  assert.equal(pickLanguage(null, ['es-AR']), 'es');
});

test('tab names and Settings language abbreviations', () => {
  assert.deepEqual(Object.values(texts('es').tabs), ['HOY', 'TODO', 'URGENCIA']);
  assert.deepEqual(Object.values(texts('en').tabs), ['TODAY', 'TODO', 'URGENCY']);
  assert.deepEqual(Object.values(texts('it').tabs), ['OGGI', 'TODO', 'URGENZA']);
  assert.deepEqual(LANGUAGES.map((l) => LANGUAGE_ABBREVIATIONS[l]), ['ESP', 'ENG', 'ITA']);
  for (const l of LANGUAGES) assert.equal(texts(l).languageAuto, 'AUTO');
});
