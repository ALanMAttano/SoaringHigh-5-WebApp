// The Settings screen (gear in the header): Appearance · Categories · Sync · App, like the desktop Settings window.
// Every change is saved at once through ctx.update(); sliders only restyle while dragging (no re-render).
import { HUE_MAX, HUE_MIN, SATURATION_MAX, SATURATION_MIN } from './color.js';
import { APP_NAME, AUTHOR, PWA_VERSION, RELEASES_URL } from './app-info.js';
import { CATEGORY_COUNT } from './merge.js';
import { MAX_CATEGORY_NAME_LENGTH, categoryColor, customCategoryName, renameCategory, setCategoryColor } from './settings.js';
import { button, el } from './dom.js';
import { format } from './i18n.js';

/**
 * ctx: { t, settings, update(next, { rerender, sync }), previewTuning(hue, saturation), sync: { connected, configured,
 * busy, statusText, lastSyncText, conflicts }, onConnect(), onSyncNow() }
 */
export function renderSettings(container, ctx) {
  container.replaceChildren(
    section(ctx.t.appearance, ...appearanceRows(ctx)),
    section(ctx.t.categoriesHeading, ...categoryRows(ctx), el('p', { className: 'note', textContent: ctx.t.colorsLocal })),
    section(ctx.t.syncHeading, ...syncRows(ctx)),
    section(ctx.t.appHeading, ...appRows(ctx)));
}

const section = (title, ...rows) => el('section', { className: 'settings-section' }, el('h2', { textContent: title }), ...rows);

const row = (label, ...controls) => el('div', { className: 'settings-row' },
  el('span', { className: 'settings-label', textContent: label }), el('div', { className: 'settings-controls' }, ...controls));

// --- Appearance

function appearanceRows(ctx) {
  const { t, settings } = ctx;
  const languages = [[null, t.languageAuto], ['es', 'Español'], ['en', 'English'], ['it', 'Italiano']];
  const tabs = el('div', { className: 'choice' }, ...languages.map(([code, name]) =>
    button(name, () => ctx.update({ ...settings, language: code }), 'tab' + (settings.language === code ? ' active' : ''))));
  const hue = slider('hue', HUE_MIN, HUE_MAX, settings.hue, (v) => `${v > 0 ? '+' : ''}${v}°`);
  const saturation = slider('saturation', SATURATION_MIN, SATURATION_MAX, settings.saturation, (v) => `${v} %`);
  const preview = () => ctx.previewTuning(hue.value(), saturation.value());
  const commit = () => ctx.update({ ...settings, hue: hue.value(), saturation: saturation.value() }, { rerender: false });
  for (const s of [hue, saturation]) { s.input.addEventListener('input', preview); s.input.addEventListener('change', commit); }
  return [row(t.language, tabs), row(t.hue, hue.node), row(t.saturation, saturation.node),
    row('', button(t.resetColors, () => ctx.update({ ...settings, hue: 0, saturation: 100 })))];
}

function slider(id, min, max, value, label) {
  const input = el('input', { type: 'range', id: `setting-${id}`, min, max, step: 1, value });
  const readout = el('span', { className: 'readout', textContent: label(value) });
  input.addEventListener('input', () => { readout.textContent = label(Number(input.value)); });
  return { input, node: el('div', { className: 'slider' }, input, readout), value: () => Number(input.value) };
}

// --- Categories

function categoryRows(ctx) {
  return Array.from({ length: CATEGORY_COUNT }, (_, i) => {
    const swatch = el('input', { type: 'color', className: 'swatch', value: categoryColor(ctx.settings, i), title: ctx.t.pickColor });
    swatch.addEventListener('change', () => ctx.update(setCategoryColor(ctx.settings, i, swatch.value)));
    const name = el('input', { className: 'category-name', maxLength: MAX_CATEGORY_NAME_LENGTH, value: customCategoryName(ctx.settings, i) ?? '',
      placeholder: ctx.t.categories[i], autocomplete: 'off', enterKeyHint: 'done' });
    name.addEventListener('change', () => ctx.update(renameCategory(ctx.settings, i, name.value), { rerender: false, sync: true }));
    const reset = button('↺', () => ctx.update(setCategoryColor(ctx.settings, i, null)), 'btn icon');
    reset.title = ctx.t.defaultColor;
    reset.hidden = !ctx.settings.categoryColors[i];
    return el('div', { className: 'settings-row category' }, swatch, name, reset);
  });
}

// --- Sync

function syncRows({ t, sync, onConnect, onSyncNow }) {
  const connect = button(sync.connected ? t.disconnect : t.connect, onConnect, 'btn' + (sync.connected ? '' : ' primary'));
  connect.disabled = !sync.configured || sync.busy;
  const now = button(t.syncNow, onSyncNow);
  now.disabled = !sync.connected || sync.busy;
  return [row(t.status, el('span', { className: 'value', textContent: sync.statusText })),
    row(t.lastSync, el('span', { className: 'value', textContent: sync.lastSyncText ?? '–' })),
    row(t.conflictsLabel, el('span', { className: 'value', textContent: String(sync.conflicts) })),
    row('Google Drive', connect, now)];
}

// --- App

function appRows({ t }) {
  const changeLog = el('a', { className: 'btn', href: RELEASES_URL, target: '_blank', rel: 'noopener noreferrer', textContent: t.viewChangeLog, title: t.changeLogTip });
  return [row(t.changeLog, changeLog), el('p', { className: 'note', textContent: t.changeLogTip }),
    el('p', { className: 'credit', textContent: `${APP_NAME} ${PWA_VERSION}  ·  ${format(t.madeBy, AUTHOR)}` })];
}
