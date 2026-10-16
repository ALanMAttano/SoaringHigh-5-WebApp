// Spanish, English and Italian texts (Spanish is the default when the browser is neither English nor Italian).
const TEXTS = {
  es: {
    tabs: { today: 'HOY', todo: 'TODO', urgency: 'URGENCIA' },
    settings: 'Ajustes', appearance: 'APARIENCIA', language: 'Idioma', languageAuto: 'AUTO', hue: 'Tono del texto', saturation: 'Saturación del texto',
    resetColors: 'RESTABLECER COLORES', categoriesHeading: 'CATEGORÍAS', pickColor: 'Elegir color', defaultColor: 'Color original',
    colorsLocal: 'Los nombres se sincronizan con la PC; los colores quedan solo en este teléfono.',
    syncHeading: 'SINCRONIZACIÓN', status: 'Estado', lastSync: 'Última sincronización',
    appHeading: 'APP', changeLog: 'Registro de cambios', viewChangeLog: 'VER CAMBIOS',
    changeLogTip: 'Abre el historial de versiones en GitHub (hay que iniciar sesión: el repositorio es privado).', madeBy: 'hecho por {0}',
    add: 'AGREGAR', save: 'GUARDAR', delete: 'BORRAR', done: 'HECHO', undo: 'DESHACER', cancel: 'CANCELAR',
    toToday: '→ HOY', inToday: 'EN HOY', locale: 'es-AR',
    emptySlot: 'Libre: tocá para agregar una tarea', placeholder: 'Tarea de hoy…', todoPlaceholder: 'Nueva tarea para la lista…',
    editHint: 'Tocá una tarea para editarla; mantené presionado y arrastrá para reordenar entre las de igual urgencia.', sameUrgencyOnly: 'Solo se puede reordenar entre tareas de la misma urgencia.', category: 'Categoría', urgencyLabel: 'Urgencia',
    connect: 'CONECTAR GOOGLE DRIVE', disconnect: 'DESCONECTAR', syncNow: 'SINCRONIZAR',
    notConfigured: 'Falta el client ID en config.js (ver docs/SYNC_SETUP.md).',
    off: 'Sin conectar: los datos quedan solo en este teléfono.', running: 'Sincronizando…', synced: 'Sincronizado {0}',
    offline: 'Sin conexión: se sincroniza al volver la red.', authFailed: 'Tocá SINCRONIZAR para volver a iniciar sesión.',
    failed: 'Falló la sincronización.', busy: 'Otro dispositivo estaba sincronizando; reintentá.', reconnect: 'Sesión vencida: tocá SINCRONIZAR.',
    slotBusy: 'Ese lugar ya tiene una tarea pendiente.', carried: '{0} tarea(s) pasaron a hoy.', conflicts: 'Conflictos guardados: {0}',
    noFreeSlot: 'Los 5 lugares de hoy están ocupados: terminá o borrá una tarea primero.', sent: 'Agregada a hoy en {0}.', swapped: 'La tarea menos importante de {0} volvió al TODO.', outranked: 'Quedó en el TODO: la tarea de hoy en {0} es más importante.',
    alreadyThere: 'Esa tarea ya está en la lista de hoy.', empty: 'Escribí un texto primero.', confirmDelete: '¿Borrar «{0}»?',
    noTodo: 'La lista está vacía.', categories: ['Finanzas', 'Familia', 'Casa', 'Yo', 'Amigos'],
    urgency: { urgentImportant: 'URG+IMP', urgent: 'URGENTE', important: 'IMPORTANTE', normal: 'NORMAL', wish: 'DESEO' },
    urgencyGroup: { urgentImportant: 'Urgente e importante', urgent: 'Urgente', important: 'Importante', normal: 'Normal', wish: 'Deseo' },
  },
  en: {
    tabs: { today: 'TODAY', todo: 'TODO', urgency: 'URGENCY' },
    settings: 'Settings', appearance: 'APPEARANCE', language: 'Language', languageAuto: 'AUTO', hue: 'Text hue', saturation: 'Text saturation',
    resetColors: 'RESET COLOURS', categoriesHeading: 'CATEGORIES', pickColor: 'Pick a colour', defaultColor: 'Original colour',
    colorsLocal: 'Names sync with the PC; colours stay on this phone only.',
    syncHeading: 'SYNC', status: 'Status', lastSync: 'Last sync',
    appHeading: 'APP', changeLog: 'Change log', viewChangeLog: 'VIEW CHANGE LOG',
    changeLogTip: 'Opens the release history on GitHub (sign-in needed: the repository is private).', madeBy: 'made by {0}',
    add: 'ADD', save: 'SAVE', delete: 'DELETE', done: 'DONE', undo: 'UNDO', cancel: 'CANCEL',
    toToday: '→ TODAY', inToday: 'TODAY', locale: 'en-US',
    emptySlot: 'Free: tap to add a task', placeholder: "Today's task…", todoPlaceholder: 'New task for the list…',
    editHint: 'Tap a task to edit it; long-press and drag to reorder tasks of the same urgency.', sameUrgencyOnly: 'Tasks can only be reordered among the same urgency.', category: 'Category', urgencyLabel: 'Urgency',
    connect: 'CONNECT GOOGLE DRIVE', disconnect: 'DISCONNECT', syncNow: 'SYNC NOW',
    notConfigured: 'Client ID missing in config.js (see docs/SYNC_SETUP.md).',
    off: 'Not connected: data stays on this phone only.', running: 'Syncing…', synced: 'Synced {0}',
    offline: 'Offline: will sync when the network is back.', authFailed: 'Tap SYNC NOW to sign in again.',
    failed: 'Sync failed.', busy: 'Another device was syncing; try again.', reconnect: 'Session expired: tap SYNC NOW.',
    slotBusy: 'That slot already has a pending task.', carried: '{0} task(s) moved to today.', conflicts: 'Conflicts kept: {0}',
    noFreeSlot: "All 5 of today's slots are taken: finish or delete a task first.", sent: 'Added to today in {0}.', swapped: 'The less important {0} task went back to TODO.', outranked: "Stayed in TODO: today's {0} task is more important.",
    alreadyThere: "That task is already on today's list.", empty: 'Type some text first.', confirmDelete: 'Delete “{0}”?',
    noTodo: 'The list is empty.', categories: ['Finance', 'Family', 'Home', 'Me', 'Friends'],
    urgency: { urgentImportant: 'URG+IMP', urgent: 'URGENT', important: 'IMPORTANT', normal: 'NORMAL', wish: 'WISH' },
    urgencyGroup: { urgentImportant: 'Urgent & important', urgent: 'Urgent', important: 'Important', normal: 'Normal', wish: 'Wish' },
  },
  it: {
    tabs: { today: 'OGGI', todo: 'TODO', urgency: 'URGENZA' },
    settings: 'Impostazioni', appearance: 'ASPETTO', language: 'Lingua', languageAuto: 'AUTO', hue: 'Tonalità del testo', saturation: 'Saturazione del testo',
    resetColors: 'RIPRISTINA COLORI', categoriesHeading: 'CATEGORIE', pickColor: 'Scegli un colore', defaultColor: 'Colore originale',
    colorsLocal: 'I nomi si sincronizzano con il PC; i colori restano solo su questo telefono.',
    syncHeading: 'SINCRONIZZAZIONE', status: 'Stato', lastSync: 'Ultima sincronizzazione',
    appHeading: 'APP', changeLog: 'Registro modifiche', viewChangeLog: 'VEDI MODIFICHE',
    changeLogTip: "Apre la cronologia delle versioni su GitHub (serve l'accesso: il repository è privato).", madeBy: 'creato da {0}',
    add: 'AGGIUNGI', save: 'SALVA', delete: 'ELIMINA', done: 'FATTO', undo: 'ANNULLA', cancel: 'CHIUDI',
    toToday: '→ OGGI', inToday: 'OGGI', locale: 'it-IT',
    emptySlot: 'Libero: tocca per aggiungere un compito', placeholder: 'Compito di oggi…', todoPlaceholder: 'Nuovo compito per la lista…',
    editHint: 'Tocca un compito per modificarlo; tieni premuto e trascina per riordinare quelli con la stessa urgenza.', sameUrgencyOnly: 'Si può riordinare solo tra compiti con la stessa urgenza.', category: 'Categoria', urgencyLabel: 'Urgenza',
    connect: 'COLLEGA GOOGLE DRIVE', disconnect: 'SCOLLEGA', syncNow: 'SINCRONIZZA',
    notConfigured: 'Manca il client ID in config.js (vedi docs/SYNC_SETUP.md).',
    off: 'Non collegato: i dati restano solo su questo telefono.', running: 'Sincronizzazione…', synced: 'Sincronizzato {0}',
    offline: 'Offline: si sincronizza quando torna la rete.', authFailed: 'Tocca SINCRONIZZA per accedere di nuovo.',
    failed: 'Sincronizzazione non riuscita.', busy: 'Un altro dispositivo stava sincronizzando; riprova.', reconnect: 'Sessione scaduta: tocca SINCRONIZZA.',
    slotBusy: 'Quel posto ha già un compito in sospeso.', carried: '{0} compito/i spostati a oggi.', conflicts: 'Conflitti salvati: {0}',
    noFreeSlot: 'I 5 posti di oggi sono occupati: completa o elimina prima un compito.', sent: 'Aggiunto a oggi in {0}.', swapped: "Il compito meno importante di {0} è tornato nel TODO.", outranked: "Rimasto nel TODO: il compito di oggi in {0} è più importante.",
    alreadyThere: 'Quel compito è già nella lista di oggi.', empty: 'Scrivi prima un testo.', confirmDelete: 'Eliminare «{0}»?',
    noTodo: 'La lista è vuota.', categories: ['Finanze', 'Famiglia', 'Casa', 'Io', 'Amici'],
    urgency: { urgentImportant: 'URG+IMP', urgent: 'URGENTE', important: 'IMPORTANTE', normal: 'NORMALE', wish: 'DESIDERIO' },
    urgencyGroup: { urgentImportant: 'Urgente e importante', urgent: 'Urgente', important: 'Importante', normal: 'Normale', wish: 'Desiderio' },
  },
};

export const LANGUAGES = Object.keys(TEXTS);

/** Short labels for the Settings language buttons. */
export const LANGUAGE_ABBREVIATIONS = Object.freeze({ es: 'ESP', en: 'ENG', it: 'ITA' });

export function pickLanguage(saved, browserLanguages) {
  if (saved && TEXTS[saved]) return saved;
  const prefix = (browserLanguages || []).map((l) => l.toLowerCase().slice(0, 2)).find((l) => l === 'en' || l === 'it');
  return prefix ?? 'es';
}

export function texts(lang) { return TEXTS[lang] || TEXTS.es; }

export function format(pattern, ...args) {
  return pattern.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}
