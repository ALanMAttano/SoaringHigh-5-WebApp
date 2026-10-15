// SoaringHigh-5 PWA: today's 5 slots + TODO list, stored locally (offline-first) and synced through Google Drive.
import { GOOGLE_CLIENT_ID } from './config.js';
import { URGENCIES, stamp, toPlanner, parseDocument } from './merge.js';
import { addBacklog, addToSlot, emptyPlanner, ensureRollover, localDay, setSlotStatus } from './planner.js';
import { GoogleAuth, DriveStore } from './sync.js';
import { syncOnce } from './engine.js';
import { format, pickLanguage, texts } from './i18n.js';

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
  editingSlot: null,
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
    render();
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

function render() {
  $('date').textContent = new Date().toLocaleDateString(state.lang === 'es' ? 'es-AR' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('tab-today').textContent = t().today;
  $('tab-todo').textContent = t().todo;
  $('tab-today').classList.toggle('active', state.view === 'today');
  $('tab-todo').classList.toggle('active', state.view === 'todo');
  $('view-today').hidden = state.view !== 'today';
  $('view-todo').hidden = state.view !== 'todo';
  $('lang').textContent = state.lang === 'es' ? 'EN' : 'ES';
  document.documentElement.lang = state.lang;
  renderSlots();
  renderTodo();
  renderFooter();
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function urgencyPill(u) {
  const pill = el('span', { className: 'pill' + (u === 'urgentImportant' ? ' filled' : ''), textContent: t().urgency[u] ?? u });
  pill.style.color = URGENCY_COLORS[u] ?? URGENCY_COLORS.normal;
  return pill;
}

function urgencySelect(id) {
  const select = el('select', { id });
  for (const u of URGENCIES) select.append(el('option', { value: u, textContent: t().urgency[u], selected: u === 'normal' }));
  return select;
}

function categoryLabel(i) {
  const label = el('span', { className: 'cat', textContent: categoryName(i) });
  label.style.color = CATEGORY_COLORS[i];
  return label;
}

function renderSlots() {
  const today = localDay();
  const list = $('slots');
  list.replaceChildren();
  for (const slot of state.planner.slotOrder) {
    const task = state.planner.slotTasks.filter((x) => x.date === today && x.slot === slot).at(-1);
    const li = el('li', {}, categoryLabel(slot));
    if (state.editingSlot === slot) li.append(slotForm(slot));
    else if (!task || task.status !== 'pending') li.append(...slotView(slot, task));
    else li.append(el('span', { className: 'text', textContent: task.text }), urgencyPill(task.urgency), actionButton(t().done, () => markStatus(task.id, 'done')));
    list.append(li);
  }
}

function slotView(slot, finished) {
  const open = () => { state.editingSlot = slot; render(); $('slot-text')?.focus(); };
  if (!finished) {
    const empty = el('span', { className: 'text empty', textContent: t().emptySlot });
    empty.addEventListener('click', open);
    return [empty];
  }
  const text = el('span', { className: 'text finished', textContent: finished.text });
  text.addEventListener('click', open);
  return [text, actionButton(t().undo, () => markStatus(finished.id, 'pending'))];
}

function slotForm(slot) {
  const form = el('form', { className: 'slot-form' },
    el('input', { id: 'slot-text', maxLength: 200, placeholder: t().placeholder, autocomplete: 'off' }),
    urgencySelect('slot-urgency'),
    el('button', { className: 'btn primary', type: 'submit', textContent: t().add }),
    actionButton(t().cancel, () => { state.editingSlot = null; render(); }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const result = addToSlot(state.planner, slot, $('slot-text').value, $('slot-urgency').value, localDay());
    if (result === 'slotBusy') showNotice(t().slotBusy);
    if (result === 'added' || result === 'slotBusy') { state.editingSlot = null; persist(); }
  });
  return form;
}

function actionButton(text, onClick) {
  const b = el('button', { className: 'btn', type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

function markStatus(id, status) {
  setSlotStatus(state.planner, id, status);
  persist();
}

function renderTodo() {
  $('todo-text').placeholder = t().todoPlaceholder;
  $('todo-add').textContent = t().add;
  const category = $('todo-category');
  const chosen = category.value;
  category.replaceChildren(...[0, 1, 2, 3, 4].map((i) => el('option', { value: String(i), textContent: categoryName(i) })));
  category.value = chosen || '0';
  if (!$('todo-urgency').options.length) $('todo-urgency').replaceWith(urgencySelect('todo-urgency'));
  const list = $('todo-list');
  const open = state.planner.backlog.filter((b) => b.status === 'open')
    .sort((a, b) => a.category - b.category || a.categoryOrder - b.categoryOrder);
  list.replaceChildren(...(open.length ? open.map((b) => el('li', {}, categoryLabel(b.category), el('span', { className: 'text', textContent: b.text }), urgencyPill(b.urgency),
    actionButton(t().done, () => { b.status = 'done'; persist(); })))
    : [el('li', {}, el('span', { className: 'text empty', textContent: t().noTodo }))]));
}

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
  return last ? format(t().synced, new Date(last).toLocaleTimeString(state.lang === 'es' ? 'es-AR' : 'en-US', { hour: '2-digit', minute: '2-digit' })) : t().running;
}

function showNotice(text) {
  const notice = $('notice');
  notice.textContent = text;
  notice.hidden = false;
  setTimeout(() => { notice.hidden = true; }, 6000);
}

// ------------------------------------------------------------------ start

$('tab-today').addEventListener('click', () => { state.view = 'today'; render(); });
$('tab-todo').addEventListener('click', () => { state.view = 'todo'; render(); });
$('lang').addEventListener('click', () => { state.lang = state.lang === 'es' ? 'en' : 'es'; localStorage.setItem(KEY.lang, state.lang); render(); });
$('connect').addEventListener('click', toggleConnection);
$('sync').addEventListener('click', () => syncNow(true));
$('todo-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (addBacklog(state.planner, $('todo-text').value, Number($('todo-category').value), $('todo-urgency').value) === 'added') {
    $('todo-text').value = '';
    persist();
  }
});
window.addEventListener('online', () => scheduleSync(1000));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  rollover();
  render();
  scheduleSync(1000);
});
setInterval(() => { if (state.planner.lastRolloverDate !== localDay()) { rollover(); render(); } }, DAY_CHECK_MS);
setInterval(() => scheduleSync(0), PERIODIC_MS);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

rollover();
render();
scheduleSync(1500);
