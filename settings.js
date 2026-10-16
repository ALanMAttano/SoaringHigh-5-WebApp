// Phone settings (Settings screen), kept in localStorage under one key. Pure functions over a Storage-like object
// (getItem/setItem/removeItem) so they can be tested in node.
//   language        null = follow the phone, or 'es' | 'en' | 'it'
//   hue, saturation text colour tuning, same ranges as the desktop (color.js)
//   categoryNames   null = not set on this phone (follow sync), or 5 entries (string | null = default name). SYNCED:
//                   the same register the desktop syncs (AppSettings.CategoryNames).
//   categoryColors  5 entries ('#RRGGBB' | null = default). LOCAL ONLY: the desktop has fixed category colours.
import { clampTuning } from './color.js';
import { CATEGORY_COUNT } from './merge.js';

export const SETTINGS_KEY = 'sh5.settings';
const LEGACY_LANGUAGE_KEY = 'sh5.lang';
export const MAX_CATEGORY_NAME_LENGTH = 24; // AppSettings.MaxCategoryNameLength
export const LANGUAGE_CODES = ['es', 'en', 'it'];
export const DEFAULT_CATEGORY_COLORS = Object.freeze(['#00FF41', '#FF4FD8', '#00E5FF', '#5C7CFF', '#FF9E3D']); // Palette.cs

const HEX = /^#[0-9A-F]{6}$/;
const fiveOf = (list, norm) => Array.from({ length: CATEGORY_COUNT }, (_, i) => norm(Array.isArray(list) ? list[i] : null));

/** Like AppSettings.NormalizeCategoryNames: exactly 5 entries, trimmed, one line, length-limited, blank → null. */
export function normalizeCategoryNames(names) {
  return fiveOf(names, (n) => {
    if (typeof n !== 'string' || !n.trim()) return null;
    const one = n.trim().replace(/\r?\n/g, ' ');
    return one.length > MAX_CATEGORY_NAME_LENGTH ? one.slice(0, MAX_CATEGORY_NAME_LENGTH) : one;
  });
}

export const normalizeCategoryColors = (colors) =>
  fiveOf(colors, (c) => (typeof c === 'string' && HEX.test(c.toUpperCase()) ? c.toUpperCase() : null));

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    language: LANGUAGE_CODES.includes(s.language) ? s.language : null,
    ...clampTuning(s.hue, s.saturation),
    categoryNames: s.categoryNames == null ? null : normalizeCategoryNames(s.categoryNames),
    categoryColors: normalizeCategoryColors(s.categoryColors),
  };
}

export const defaultSettings = () => normalizeSettings(null);

/** Reads the settings; a language chosen with the old header button (v2.27 and earlier) is carried over. */
export function loadSettings(storage) {
  let raw = null;
  try { raw = JSON.parse(storage.getItem(SETTINGS_KEY)); } catch { raw = null; }
  const settings = normalizeSettings(raw);
  const legacy = storage.getItem(LEGACY_LANGUAGE_KEY);
  if (!raw && LANGUAGE_CODES.includes(legacy)) settings.language = legacy;
  return settings;
}

export function saveSettings(storage, settings) {
  storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  storage.removeItem(LEGACY_LANGUAGE_KEY);
}

/** Renames one category (blank → default name). Returns the new settings; the input is not changed. */
export function renameCategory(settings, category, name) {
  const names = normalizeCategoryNames(settings.categoryNames);
  names[category] = name;
  return { ...settings, categoryNames: normalizeCategoryNames(names) };
}

export function setCategoryColor(settings, category, color) {
  const colors = [...settings.categoryColors];
  colors[category] = color;
  return { ...settings, categoryColors: normalizeCategoryColors(colors) };
}

export const categoryColor = (settings, category) => settings.categoryColors[category] ?? DEFAULT_CATEGORY_COLORS[category];

/** The custom name, or null when the default (localized) name applies. */
export const customCategoryName = (settings, category) => settings.categoryNames?.[category] ?? null;

/** What to pass to merge.stamp(): null when never set here, so an untouched phone cannot overwrite the desktop's names. */
export const categoryNamesForSync = (settings) => settings.categoryNames;

/** After a sync: take the merged names (the newest edit on any device wins). */
export function adoptSyncedCategoryNames(settings, mergedDoc) {
  const value = mergedDoc?.categoryNames?.value;
  return value ? { ...settings, categoryNames: normalizeCategoryNames(value) } : settings;
}
