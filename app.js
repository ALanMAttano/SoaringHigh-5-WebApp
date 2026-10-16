// SoaringHigh-5 PWA: today's 5 slots + TODO list, stored locally (offline-first) and synced through Google Drive.
import { GOOGLE_CLIENT_ID } from './config.js';
import { CATEGORY_COUNT, URGENCIES, stamp, toPlanner, parseDocument } from './merge.js';
import {
  MAX_TEXT_LENGTH, addBacklog, addToSlot, backlogByUrgency, completeBacklog, currentInSlot, deleteBacklog, deleteSlotTask, emptyPlanner,
  ensureRollover, isSlotFree, localDay, sendToToday, setSlotStatus, todayTaskFor, updateBacklog, updateSlotTask,
} from './planner.js';
import { GoogleAuth, DriveStore } from './sync.js';
import { syncOnce } from './engine.js';
import { format, nextLanguage, pickLanguage, texts } from './i18n.js';

const KEY = { planner: 'sh5.planner', snapshot: 'sh5.snapshot', device: 'sh5.deviceId', lang: 'sh5.lang', lastSync: 'sh5.lastSync', connected: 'sh5.connected' };
const CHANGE_DEBOUNCE_MS = 5000;
const PERIODIC_MS = 5 * 60 * 1000;
const DAY_CHECK_MS = 60 * 1000;
const CATEGORY_COLORS = ['#00FF41', '#FF4FD8', '#00E5FF', '#5C7CFF', '#FF9E3D'];
const URGENCY_COLORS = { urgentImportant: '#FF003C', urgent: '#FF7A1A', important: '#FFC400', normal: '#3DBA5A', wish: '#8FA8FF' };

const $ = (id) => document.getElementById(id);
const load = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const state = {
  lang: pickLanguage(localStorage.getItem(KEY.lang), navigator.languages),
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

const t = () => texts(state.lang);
const snapshot = () => parseDocument(localStorage.getItem(KEY.snapshot));
const isConnected = () => localStorage.getItem(KEY.connected) === '1';

function categoryName(i) {
  const custom = snapshot()?.categoryNames?.value?.[i];
  return custom && custom.trim() ? custom : t().categories[i];
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
    const before = JSON.stringify(state.planner);
    const base = snapshot();
    const local = stamp(state.planner, base, Date.now(), state.deviceId, null);
    const outcome = await syncOnce(drive, local, base, state.deviceId);
    if (outcome.status === 'synced') {
      if (JSON.stringify(state.planner) === before) {
        state.planner = toPlanner(outcome.merged, localDay());
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
  renderFooter();
}

// ------------------------------------------------------------------ UI

/** What the inline editor is open on: a free slot (new task), a daily task, or a TODO item. */
const editing = {
  none: () => { state.editing = null; },
  is: (kind, key) => state.editing?.kind === kind && state.editing.key === key,
  open: (kind, key) => { state.editing = { kind, key }; render(); document.querySelector('.editor input')?.focus(); },
};

function render() {
  $('date').textContent = new Date().toLocaleDateString(t().locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderTabs();
  $('lang').textContent = nextLanguage(state.lang).toUpperCase();
  document.documentElement.lang = state.lang;
  renderSlots();
  renderTodo();
  renderFooter();
}

function renderTabs() {
  for (const view of ['today', 'todo']) {
    $(`tab-${view}`).textContent = t()[view];
    $(`tab-${view}`).classList.toggle('active', state.view === view);
    $(`view-${view}`).hidden = state.view !== view;
  }
  $('hint').textContent = t().editHint;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function button(text, onClick, className = 'btn') {
  const b = el('button', { className, type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

function tappable(node, onTap) {
  node.classList.add('tappable');
  node.addEventListener('click', onTap);
  return node;
}

function urgencyPill(u) {
  const pill = el('span', { className: 'pill' + (u === 'urgentImportant' ? ' filled' : ''), textContent: t().urgency[u] ?? u });
  pill.style.color = URGENCY_COLORS[u] ?? URGENCY_COLORS.normal;
  return pill;
}

function categoryLabel(i) {
  const label = el('span', { className: 'cat', textContent: categoryName(i) });
  label.style.color = CATEGORY_COLORS[i];
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
  const busyFor = (own) => (slot) => slot !== own && !isSlotFree(state.planner, slot, today);
  $('slots').replaceChildren(...state.planner.slotOrder.map((slot) => {
    const task = currentInSlot(state.planner, slot, today);
    const li = el('li', {}, categoryLabel(slot));
    if (task?.status === 'pending' && editing.is('task', task.id)) li.append(taskEditor(task, busyFor(task.slot)));
    else if (task?.status === 'pending') li.append(...pendingTaskRow(task));
    else if (editing.is('slot', slot)) li.append(newTaskEditor(slot, busyFor(slot)));
    else li.append(...freeSlotRow(slot, task));
    return li;
  }));
}

function pendingTaskRow(task) {
  return [tappable(el('span', { className: 'text', textContent: task.text }), () => editing.open('task', task.id)),
    urgencyPill(task.urgency), button(t().done, () => markStatus(task.id, 'done'))];
}

/** A free slot: empty, or holding today's finished task (tap to add a new one, UNDO to reopen). */
function freeSlotRow(slot, finished) {
  const add = () => editing.open('slot', slot);
  if (!finished) return [tappable(el('span', { className: 'text empty', textContent: t().emptySlot }), add)];
  return [tappable(el('span', { className: 'text finished', textContent: finished.text }), add), button(t().undo, () => markStatus(finished.id, 'pending'))];
}

function newTaskEditor(slot, busyCategory) {
  return editorForm({ category: slot, placeholder: t().placeholder, saveLabel: t().add, busyCategory,
    onSave: (text, category, urgency) => addToSlot(state.planner, category, text, urgency, localDay()) });
}

function taskEditor(task, busyCategory) {
  return editorForm({ text: task.text, category: task.slot, urgency: task.urgency, placeholder: t().placeholder, saveLabel: t().save, busyCategory,
    onSave: (text, category, urgency) => updateSlotTask(state.planner, task.id, text, urgency, category),
    onDelete: () => confirmDelete(task.text, () => deleteSlotTask(state.planner, task.id)) });
}

function markStatus(id, status) {
  setSlotStatus(state.planner, id, status);
  persist();
}

// --- TODO: grouped by urgency

function renderTodo() {
  $('todo-text').placeholder = t().todoPlaceholder;
  $('todo-add').textContent = t().add;
  const chosen = Number($('todo-category').value || 0);
  $('todo-category').replaceWith(categorySelect('todo-category', chosen));
  $('todo-urgency').replaceWith(urgencySelect('todo-urgency', $('todo-urgency').value || 'normal'));
  const groups = backlogByUrgency(state.planner);
  $('todo-list').replaceChildren(...(groups.length ? groups.flatMap(urgencyGroup)
    : [el('li', {}, el('span', { className: 'text empty', textContent: t().noTodo }))]));
}

function urgencyGroup({ urgency, items }) {
  const heading = el('li', { className: 'group', textContent: `${t().urgencyGroup[urgency]} · ${items.length}` });
  heading.style.color = URGENCY_COLORS[urgency];
  return [heading, ...items.map((item) => el('li', {}, ...(editing.is('item', item.id) ? [itemEditor(item)] : todoRow(item))))];
}

function todoRow(item) {
  const inToday = todayTaskFor(state.planner, item.id, localDay());
  return [categoryLabel(item.category), tappable(el('span', { className: 'text', textContent: item.text }), () => editing.open('item', item.id)),
    inToday ? el('span', { className: 'tag', textContent: t().inToday }) : button(t().toToday, () => sendItemToToday(item)),
    button(t().done, () => { completeBacklog(state.planner, item.id, localDay()); persist(); })];
}

function itemEditor(item) {
  return editorForm({ text: item.text, category: item.category, urgency: item.urgency, placeholder: t().todoPlaceholder, saveLabel: t().save,
    onSave: (text, category, urgency) => updateBacklog(state.planner, item.id, text, category, urgency, localDay()),
    onDelete: () => confirmDelete(item.text, () => deleteBacklog(state.planner, item.id)) });
}

function sendItemToToday(item) {
  const { result, slot } = sendToToday(state.planner, item.id, localDay());
  if (result !== 'sent') { showResult(result); return; }
  showNotice(format(t().sent, categoryName(slot)));
  persist();
}

function addTodoFromForm(e) {
  e.preventDefault();
  const result = addBacklog(state.planner, $('todo-text').value, Number($('todo-category').value), $('todo-urgency').value);
  if (result !== 'added') { showResult(result); return; }
  $('todo-text').value = '';
  persist();
}

/** Planner refusals as a short notice ('empty', 'slotBusy', 'noFreeSlot', 'alreadyToday'); a task or item that
 * vanished meanwhile (sync, day change) just closes the editor. */
function showResult(result) {
  if (result === 'notFound') { editing.none(); render(); return; }
  const text = t()[result];
  if (text) showNotice(text);
}

/** Background refreshes (sync, day change) must not wipe text being typed in an open editor. */
function renderUnlessEditing() {
  if (state.editing) renderFooter();
  else render();
}

// --- footer

function renderFooter() {
  const connected = isConnected();
  $('connect').textContent = connected ? t().disconnect : t().connect;
  $('connect').disabled = !auth.configured || state.syncing;
  $('sync').textContent = t().syncNow;
  $('sync').disabled = !connected || state.syncing;
  const conflicts = snapshot()?.conflicts?.length ?? 0;
  $('sync-status').textContent = statusText() + (connected && conflicts ? ` · ${format(t().conflicts, conflicts)}` : '');
}

function statusText() {
  if (!auth.configured) return t().notConfigured;
  if (!isConnected()) return t().off;
  if (state.status && state.status !== 'synced') return t()[state.status] ?? t().failed;
  const last = Number(localStorage.getItem(KEY.lastSync));
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

for (const view of ['today', 'todo']) $(`tab-${view}`).addEventListener('click', () => { state.view = view; editing.none(); render(); });
$('lang').addEventListener('click', () => { state.lang = nextLanguage(state.lang); localStorage.setItem(KEY.lang, state.lang); render(); });
$('connect').addEventListener('click', toggleConnection);
$('sync').addEventListener('click', () => syncNow(true));
$('todo-form').addEventListener('submit', addTodoFromForm);
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

rollover();
render();
scheduleSync(1500);
