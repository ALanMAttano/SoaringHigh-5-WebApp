// Spanish + English texts (Spanish is the default when the browser is not English).
const TEXTS = {
  es: {
    today: 'HOY', todo: 'TODO', add: 'AGREGAR', done: 'HECHO', undo: 'DESHACER', cancel: 'CANCELAR',
    emptySlot: 'Libre: tocá para agregar una tarea', placeholder: 'Tarea de hoy…', todoPlaceholder: 'Nueva tarea para la lista…',
    connect: 'CONECTAR GOOGLE DRIVE', disconnect: 'DESCONECTAR', syncNow: 'SINCRONIZAR',
    notConfigured: 'Falta el client ID en config.js (ver docs/SYNC_SETUP.md).',
    off: 'Sin conectar: los datos quedan solo en este teléfono.', running: 'Sincronizando…', synced: 'Sincronizado {0}',
    offline: 'Sin conexión: se sincroniza al volver la red.', authFailed: 'Tocá SINCRONIZAR para volver a iniciar sesión.',
    failed: 'Falló la sincronización.', busy: 'Otro dispositivo estaba sincronizando; reintentá.', reconnect: 'Sesión vencida: tocá SINCRONIZAR.',
    slotBusy: 'Ese lugar ya tiene una tarea pendiente.', carried: '{0} tarea(s) pasaron a hoy.', conflicts: 'Conflictos guardados: {0}',
    noTodo: 'La lista está vacía.', categories: ['Finanzas', 'Familia', 'Casa', 'Yo', 'Amigos'],
    urgency: { urgentImportant: 'URG+IMP', urgent: 'URGENTE', important: 'IMPORTANTE', normal: 'NORMAL', wish: 'DESEO' },
  },
  en: {
    today: 'TODAY', todo: 'TODO', add: 'ADD', done: 'DONE', undo: 'UNDO', cancel: 'CANCEL',
    emptySlot: 'Free: tap to add a task', placeholder: "Today's task…", todoPlaceholder: 'New task for the list…',
    connect: 'CONNECT GOOGLE DRIVE', disconnect: 'DISCONNECT', syncNow: 'SYNC NOW',
    notConfigured: 'Client ID missing in config.js (see docs/SYNC_SETUP.md).',
    off: 'Not connected: data stays on this phone only.', running: 'Syncing…', synced: 'Synced {0}',
    offline: 'Offline: will sync when the network is back.', authFailed: 'Tap SYNC NOW to sign in again.',
    failed: 'Sync failed.', busy: 'Another device was syncing; try again.', reconnect: 'Session expired: tap SYNC NOW.',
    slotBusy: 'That slot already has a pending task.', carried: '{0} task(s) moved to today.', conflicts: 'Conflicts kept: {0}',
    noTodo: 'The list is empty.', categories: ['Finance', 'Family', 'Home', 'Me', 'Friends'],
    urgency: { urgentImportant: 'URG+IMP', urgent: 'URGENT', important: 'IMPORTANT', normal: 'NORMAL', wish: 'WISH' },
  },
};

export function pickLanguage(saved, browserLanguages) {
  if (saved && TEXTS[saved]) return saved;
  return (browserLanguages || []).some((l) => l.toLowerCase().startsWith('en')) ? 'en' : 'es';
}

export function texts(lang) { return TEXTS[lang] || TEXTS.es; }

export function format(pattern, ...args) {
  return pattern.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}
