// SoaringHigh-5 PWA: today's 5 slots + TODO list + Settings, stored locally (offline-first) and synced through Google Drive.
import { GOOGLE_CLIENT_ID } from './config.js';
import { CATEGORY_COUNT, URGENCIES, normalizeSlotOrder, stamp, toPlanner, parseDocument } from './merge.js';
import {
  MAX_TEXT_LENGTH, addBacklog, addToFreeSlot, addToSlot, backlogByCategory, backlogByUrgency, completeBacklog, currentInSlot, deleteBacklog, deleteSlotTask, emptyPlanner,
  ensureRollover, isSlotFree, localDay, moveSlotRow, sendToToday, setSlotStatus, todayTaskFor, updateBacklog, updateSlotTask,
} from './planner.js';
import { GoogleAuth, DriveStore } from './sync.js';
import { syncOnce } from './engine.js';
import { format, pickLanguage, texts } from './i18n.js';
import { tunedTheme } from './color.js';
import { APP_NAME, PWA_VERSION } from './app-info.js';
import { adoptSyncedCategoryNames, categoryColor, categoryNamesForSync, customCategoryName, loadSettings, saveSettings } from './settings.js';
import { renderSettings } from './settings-view.js';
import { $, button, el, tappable } from './dom.js';
import { enableLongPressReorder } from './reorder.js';

const KEY = { planner: 'sh5.planner', snapshot: 'sh5.snapshot', device: 'sh5.deviceId', lastSync: 'sh5.lastSync', connected: 'sh5.connected' };
const CHANGE_DEBOUNCE_MS = 5000;
const PERIODIC_MS = 5 * 60 * 1000;
const DAY_CHECK_MS = 60 * 1000;
const URGENCY_COLORS = { urgentImportant: '#FF003C', urgent: '#FF7A1A', important: '#FFC400', normal: '#3DBA5A', wish: '#8FA8FF' };

const TABS = ['today', 'todo', 'urgency'];
/** Screens; both TODO tabs show the TODO section (same add form), as a flat list or grouped by urgency. */
const SECTION_OF = { today: 'today', todo: 'todo', urgency: 'todo', settings: 'settings' };
const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const state = {
  settings: loadSettings(localStorage),
  planner: load(KEY.planner, emptyPlanner()),
  deviceId: localStorage.getItem(KEY.device) || `pwa-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
  view: 'today',
  editing: null,
  status: null,
  syncing: false,
};
localStorage.setItem(KEY.device, state.deviceId);
const auth = new GoogleAuth(GOOGLE_CLIENT_ID);
const drive = new DriveStore(auth);
let changeTimer = null;

const language = () => pickLanguage(state.settings.language, navigator.languages);
const t = () => texts(language());
const snapshot = () => parseDocument(localStorage.getItem(KEY.snapshot));
const isConnected = () => localStorage.getItem(KEY.connected) === '1';

const categoryName = (i) => customCategoryName(state.settings, i) ?? t().categories[i];

/** Saves a settings change and applies it; `sync` when the change is part of the synced data (category names). */
function updateSettings(next, { rerender = true, sync = false } = {}) {
  state.settings = next;
  saveSettings(localStorage, next);
  applyTuning();
  if (rerender) render();
  else renderMain(); // keep the Settings inputs (focus, slider) as they are
  if (sync) scheduleSync(CHANGE_DEBOUNCE_MS);
}

/** Text hue/saturation: the tuned theme colours as CSS variables (live, all text and neon borders). */
function applyTuning(tuning = state.settings) {
  for (const [name, value] of Object.entries(tunedTheme(tuning))) document.documentElement.style.setProperty(name, value);
}

// ------------------------------------------------------------------ data

function persist() {
  save(KEY.planner, state.planner);
  render();
  scheduleSync(CHANGE_DEBOUNCE_MS);
}

function rollover() {
  const r = ensureRollover(state.planner, localDay());
  save(KEY.planner, state.planner);
  if (r.carried) showNotice(format(t().carried, r.carried));
  return r;
}

// ------------------------------------------------------------------ sync

function scheduleSync(delay) {
  clearTimeout(changeTimer);
  if (isConnected() && auth.hasToken) changeTimer = setTimeout(() => syncNow(false), delay);
}

async function syncNow(interactive) {
  if (!isConnected() || state.syncing) return;
  if (!auth.hasToken && !interactive) { setStatus('reconnect'); return; }
  state.syncing = true;
  setStatus('running');
  try {
    if (!auth.hasToken) await auth.request(false);
    const unchanged = sameLocalData();
    const base = snapshot();
    const local = stamp(state.planner, base, Date.now(), state.deviceId, categoryNamesForSync(state.settings));
    const outcome = await syncOnce(drive, local, base, state.deviceId);
    if (outcome.status === 'synced') {
      if (unchanged()) {
        state.planner = toPlanner(outcome.merged, localDay());
        state.settings = adoptSyncedCategoryNames(state.settings, outcome.merged);
        saveSettings(localStorage, state.settings);
        localStorage.setItem(KEY.snapshot, JSON.stringify(outcome.merged));
        localStorage.setItem(KEY.lastSync, String(Date.now()));
        save(KEY.planner, state.planner);
        const r = ensureRollover(state.planner, localDay());
        save(KEY.planner, state.planner);
        if (r.carried || r.returned) scheduleSync(CHANGE_DEBOUNCE_MS);
      } else {
        scheduleSync(CHANGE_DEBOUNCE_MS); // edited while syncing: merge again
      }
    }
    setStatus(outcome.status);
  } catch {
    setStatus('authFailed');
  } finally {
    state.syncing = false;
    renderUnlessEditing();
  }
}

/** A check for "nothing was edited while the sync ran" (tasks, TODO items and category names). */
function sameLocalData() {
  const now = () => JSON.stringify([state.planner, state.settings.categoryNames]);
  const before = now();
  return () => now() === before;
}

async function toggleConnection() {
  if (isConnected()) {
    auth.signOut();
    localStorage.removeItem(KEY.connected);
    localStorage.removeItem(KEY.snapshot);
    localStorage.removeItem(KEY.lastSync);
    setStatus(null);
    return;
  }
  try {
    await auth.request(true);
    localStorage.setItem(KEY.connected, '1');
    await syncNow(true);
  } catch {
    setStatus('authFailed');
  }
}

function setStatus(status) {
  state.status = status;
  renderSyncInfo();
}

// ------------------------------------------------------------------ UI

/** What the inline editor is open on: a free slot (new task), a daily task, or a TODO item. */
const editing = {
  none: () => { state.editing = null; },
  is: (kind, key) => state.editing?.kind === kind && state.editing.key === key,
  open: (kind, key) => { state.editing = { kind, key }; render(); document.querySelector('.editor input')?.focus(); },
};

function render() {
  renderMain();
  if (state.view === 'settings') renderSettings($('view-settings'), settingsContext());
}

/** Everything except the Settings screen (which keeps its inputs while you type or drag). */
function renderMain() {
  $('date').textContent = new Date().toLocaleDateString(t().locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.documentElement.lang = language();
  renderTabs();
  renderSlots();
  renderTodo();
  renderFooter();
}

function renderTabs() {
  for (const section of new Set(Object.values(SECTION_OF))) $(`view-${section}`).hidden = SECTION_OF[state.view] !== section;
  for (const tab of TABS) {
    $(`tab-${tab}`).textContent = t().tabs[tab];
    $(`tab-${tab}`).classList.toggle('active', state.view === tab);
  }
  $('settings').classList.toggle('active', state.view === 'settings');
  $('settings').title = $('settings').ariaLabel = t().settings;
  $('hint').textContent = t().editHint;
  $('hint').hidden = state.view === 'settings';
}

function showView(view) {
  state.view = view;
  editing.none();
  render();
  window.scrollTo(0, 0);
}

function settingsContext() {
  return {
    t: t(), settings: state.settings, update: updateSettings,
    previewTuning: (hue, saturation) => applyTuning({ hue, saturation }),
    sync: syncInfo(), onConnect: toggleConnection, onSyncNow: () => syncNow(true),
  };
}

function urgencyPill(u) {
  const pill = el('span', { className: 'pill' + (u === 'urgentImportant' ? ' filled' : ''), textContent: t().urgency[u] ?? u });
  pill.style.color = URGENCY_COLORS[u] ?? URGENCY_COLORS.normal;
  return pill;
}

function categoryLabel(i) {
  const label = el('span', { className: 'cat', textContent: categoryName(i) });
  label.style.color = categoryColor(state.settings, i);
  return label;
}

function urgencySelect(id, selected = 'normal') {
  const select = el('select', { id, title: t().urgencyLabel });
  for (const u of URGENCIES) select.append(el('option', { value: u, textContent: t().urgency[u], selected: u === selected }));
  return select;
}

function categorySelect(id, selected, isDisabled = () => false) {
  const select = el('select', { id, title: t().category });
  for (let i = 0; i < CATEGORY_COUNT; i++)
    select.append(el('option', { value: String(i), textContent: categoryName(i), selected: i === selected, disabled: isDisabled(i) }));
  return select;
}

/**
 * Inline editor shared by the 5-list and the TODO tab: text + category + urgency, SAVE/ADD, optional DELETE, CANCEL.
 * `onSave(text, category, urgency)` returns the planner result; only 'added'/'updated' close the editor.
 */
function editorForm({ text = '', category, urgency = 'normal', placeholder, saveLabel, busyCategory, onSave, onDelete }) {
  const form = el('form', { className: 'editor' },
    el('input', { className: 'editor-text', maxLength: MAX_TEXT_LENGTH, value: text, placeholder, autocomplete: 'off', enterKeyHint: 'done' }),
    el('div', { className: 'editor-row' }, categorySelect('editor-category', category, busyCategory), urgencySelect('editor-urgency', urgency)),
    el('div', { className: 'editor-row' },
      el('button', { className: 'btn primary', type: 'submit', textContent: saveLabel }),
      onDelete ? button(t().delete, onDelete, 'btn danger') : null,
      button(t().cancel, () => { editing.none(); render(); })));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = onSave(form.querySelector('.editor-text').value, Number($('editor-category').value), $('editor-urgency').value);
    if (result === 'added' || result === 'updated') { editing.none(); persist(); } else showResult(result);
  });
  return form;
}

function confirmDelete(text, remove) {
  if (!confirm(format(t().confirmDelete, text))) return;
  remove();
  editing.none();
  persist();
}

// --- TODAY: the 5 slots

function renderSlots() {
  const today = localDay();
  refreshAddForm('today', t().placeholder, busyFor(null));
  $('slots').replaceChildren(...normalizeSlotOrder(state.planner.slotOrder).map((slot) => {
    const task = currentInSlot(state.planner, slot, today);
    if (task?.status === 'pending' && editing.is('task', task.id)) return editorRow(taskEditor(task, busyFor(task.slot)));
    if (task?.status === 'pending') return pendingTaskRow(task);
    if (editing.is('slot', slot)) return editorRow(newTaskEditor(slot, busyFor(slot)));
    return freeSlotRow(slot, task);
  }));
}

/** Category picker rule: slots with a pending task today are disabled, except the task's own. */
const busyFor = (own) => (slot) => slot !== own && !isSlotFree(state.planner, slot, localDay());

/**
 * One task row, same markup everywhere: category, urgency pill, actions and the text. CSS places them: portrait =
 * category · urgency · actions on top and the text below at full width; landscape = one line.
 */
function taskRow({ category, text, textClass = '', urgency = null, onTap, actions = [] }) {
  return el('li', { className: 'task-row' }, categoryLabel(category),
    urgency ? urgencyPill(urgency) : el('span', { className: 'pill-space' }),
    el('div', { className: 'actions' }, ...actions),
    tappable(el('span', { className: `text ${textClass}`.trim(), textContent: text }), onTap));
}

const editorRow = (editor) => el('li', { className: 'editor-row-item' }, editor);

function pendingTaskRow(task) {
  return taskRow({ category: task.slot, text: task.text, urgency: task.urgency, onTap: () => editing.open('task', task.id),
    actions: [button(t().done, () => markStatus(task.id, 'done'))] });
}

/** A free slot: empty, or holding today's finished task (tap to add a new one, UNDO to reopen). */
function freeSlotRow(slot, finished) {
  const add = () => editing.open('slot', slot);
  if (!finished) return taskRow({ category: slot, text: t().emptySlot, textClass: 'empty', onTap: add });
  return taskRow({ category: slot, text: finished.text, textClass: 'finished', urgency: finished.urgency, onTap: add,
    actions: [button(t().undo, () => markStatus(finished.id, 'pending'))] });
}

function newTaskEditor(slot, busyCategory) {
  return editorForm({ category: slot, placeholder: t().placeholder, saveLabel: t().add, busyCategory,
    onSave: (text, category, urgency) => addToSlot(state.planner, category, text, urgency, localDay()) });
}

function taskEditor(task, busyCategory) {
  return editorForm({ text: task.text, category: task.slot, urgency: task.urgency, placeholder: t().placeholder, saveLabel: t().save, busyCategory,
    onSave: (text, category, urgency) => updateSlotTask(state.planner, task.id, text, urgency, category),
    onDelete: () => confirmDelete(task.text, () => deleteSlotTask(state.planner, task.id, localDay())) });
}

/** HOY long-press drag: the slot shown at row `from` moves to row `to` (synced like the desktop's slot order). */
function moveSlotToRow(from, to) {
  const slot = normalizeSlotOrder(state.planner.slotOrder)[from];
  if (moveSlotRow(state.planner, slot, to)) persist();
}

function markStatus(id, status) {
  setSlotStatus(state.planner, id, status, localDay());
  persist();
}

// --- TODO (grouped by category) and URGENCY (grouped by urgency)

function renderTodo() {
  refreshAddForm('todo', t().todoPlaceholder);
  const groups = state.view === 'urgency'
    ? backlogByUrgency(state.planner).map(({ urgency, items }) => ({ title: t().urgencyGroup[urgency], color: URGENCY_COLORS[urgency], items }))
    : backlogByCategory(state.planner).map(({ category, items }) => ({ title: categoryName(category), color: categoryColor(state.settings, category), items }));
  const rows = groups.flatMap(groupRows);
  $('todo-list').replaceChildren(...(rows.length ? rows : [el('li', {}, el('span', { className: 'text empty', textContent: t().noTodo }))]));
}

/** A coloured heading with the count, then the group's items. */
function groupRows({ title, color, items }) {
  const heading = el('li', { className: 'group', textContent: `${title} · ${items.length}` });
  heading.style.color = color;
  return [heading, ...items.map((item) => (editing.is('item', item.id) ? editorRow(itemEditor(item)) : itemRow(item)))];
}

function itemRow(item) {
  const inToday = todayTaskFor(state.planner, item.id, localDay());
  return taskRow({ category: item.category, text: item.text, urgency: item.urgency, onTap: () => editing.open('item', item.id),
    actions: [inToday ? el('span', { className: 'tag', textContent: t().inToday }) : button(t().toToday, () => sendItemToToday(item)),
      button(t().done, () => { completeBacklog(state.planner, item.id, localDay()); persist(); })] });
}

function itemEditor(item) {
  return editorForm({ text: item.text, category: item.category, urgency: item.urgency, placeholder: t().todoPlaceholder, saveLabel: t().save,
    onSave: (text, category, urgency) => updateBacklog(state.planner, item.id, text, category, urgency, localDay()),
    onDelete: () => confirmDelete(item.text, () => deleteBacklog(state.planner, item.id)) });
}

function sendItemToToday(item) {
  const { result, slot } = sendToToday(state.planner, item.id, localDay());
  if (result !== 'moved' && result !== 'swapped') { showResult(result); return; }
  showNotice(format(result === 'swapped' ? t().swapped : t().sent, categoryName(slot)));
  persist();
}

// --- add forms (HOY and the TODO tabs): built once, refreshed in place so typed text survives re-renders

function buildAddForm(prefix, onAdd) {
  const form = $(`${prefix}-form`);
  form.append(el('input', { id: `${prefix}-text`, maxLength: MAX_TEXT_LENGTH, autocomplete: 'off', enterKeyHint: 'done' }),
    el('select', { id: `${prefix}-category` }), el('select', { id: `${prefix}-urgency` }),
    el('button', { className: 'btn primary', type: 'submit', id: `${prefix}-add` }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = onAdd($(`${prefix}-text`).value, Number($(`${prefix}-category`).value), $(`${prefix}-urgency`).value);
    if (result !== 'added') { showResult(result); return; }
    $(`${prefix}-text`).value = '';
    persist();
  });
}

function refreshAddForm(prefix, placeholder, busyCategory) {
  $(`${prefix}-text`).placeholder = placeholder;
  $(`${prefix}-add`).textContent = t().add;
  const category = $(`${prefix}-category`), urgency = $(`${prefix}-urgency`);
  const free = busyCategory ? [0, 1, 2, 3, 4].find((i) => !busyCategory(i)) ?? 0 : 0;
  const chosen = category.value === '' || (busyCategory && busyCategory(Number(category.value))) ? free : Number(category.value);
  category.replaceWith(categorySelect(category.id, chosen, busyCategory));
  urgency.replaceWith(urgencySelect(urgency.id, urgency.value || 'normal'));
}

function addTaskToToday(text, category, urgency) {
  const { result, slot } = addToFreeSlot(state.planner, text, urgency, localDay(), category);
  if (result === 'added' && slot !== category) showNotice(format(t().sent, categoryName(slot)));
  return result;
}

/** Planner refusals as a short notice ('empty', 'slotBusy', 'noFreeSlot', 'alreadyThere'); a task or item that
 * vanished meanwhile (sync, day change) just closes the editor. */
function showResult(result) {
  if (result === 'notFound') { editing.none(); render(); return; }
  const text = t()[result];
  if (text) showNotice(text);
}

/** Background refreshes (sync, day change) must not wipe text being typed in an open editor or in Settings. */
function renderUnlessEditing() {
  if (state.editing || state.view === 'settings') renderSyncInfo();
  else render();
}

// --- sync status (footer line + Settings → Sync)

function syncInfo() {
  const last = Number(localStorage.getItem(KEY.lastSync));
  return {
    connected: isConnected(), configured: auth.configured, busy: state.syncing, statusText: statusText(last),
    lastSyncText: last ? new Date(last).toLocaleString(t().locale, { dateStyle: 'short', timeStyle: 'short' }) : null,
    conflicts: snapshot()?.conflicts?.length ?? 0,
  };
}

function renderSyncInfo() {
  renderFooter();
  if (state.view === 'settings') renderSettings($('view-settings'), settingsContext());
}

function renderFooter() {
  const info = syncInfo();
  $('sync-status').textContent = info.statusText + (info.connected && info.conflicts ? ` · ${format(t().conflicts, info.conflicts)}` : '');
  $('version').textContent = `${APP_NAME} ${PWA_VERSION}`;
}

function statusText(last) {
  if (!auth.configured) return t().notConfigured;
  if (!isConnected()) return t().off;
  if (state.status && state.status !== 'synced') return t()[state.status] ?? t().failed;
  return last ? format(t().synced, new Date(last).toLocaleTimeString(t().locale, { hour: '2-digit', minute: '2-digit' })) : t().running;
}

let noticeTimer = null;

function showNotice(text) {
  const notice = $('notice');
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
}

// ------------------------------------------------------------------ start

for (const tab of TABS) $(`tab-${tab}`).addEventListener('click', () => showView(tab));
$('settings').addEventListener('click', () => showView(state.view === 'settings' ? 'today' : 'settings'));
$('sync-status').addEventListener('click', () => showView('settings'));
buildAddForm('today', addTaskToToday);
enableLongPressReorder($('slots'), { rowSelector: 'li.task-row', canStart: () => !state.editing, onDrop: moveSlotToRow });
buildAddForm('todo', (text, category, urgency) => addBacklog(state.planner, text, category, urgency));
window.addEventListener('online', () => scheduleSync(1000));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  rollover();
  renderUnlessEditing();
  scheduleSync(1000);
});
setInterval(() => { if (state.planner.lastRolloverDate !== localDay()) { rollover(); renderUnlessEditing(); } }, DAY_CHECK_MS);
setInterval(() => scheduleSync(0), PERIODIC_MS);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

applyTuning();
rollover();
render();
scheduleSync(1500);
