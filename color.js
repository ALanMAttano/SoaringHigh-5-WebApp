// Text colour tuning (Settings → Hue / Saturation), a port of src/SoaringHigh5.Core/ColorTuning.cs. Same ranges and the
// same arithmetic (float lerp, banker's rounding), so a tuning gives the very same colours on the phone and the PC
// (checked against shared fixtures by tests on both sides). Pure functions, no DOM.

export const HUE_MIN = -180, HUE_MAX = 180, HUE_DEFAULT = 0;
export const SATURATION_MIN = 35, SATURATION_MAX = 100, SATURATION_DEFAULT = 100;
export const MIN_READABLE_LUMINANCE = 0.32;
const LUMINANCE_STEP = 0.04;

export const DEFAULT_TUNING = Object.freeze({ hue: HUE_DEFAULT, saturation: SATURATION_DEFAULT });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toInt = (v, fallback) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);

/** Values out of range (old or hand-edited settings) are brought back into range, like ColorTuning.Clamped. */
export function clampTuning(hue, saturation) {
  return { hue: clamp(toInt(hue, HUE_DEFAULT), HUE_MIN, HUE_MAX), saturation: clamp(toInt(saturation, SATURATION_DEFAULT), SATURATION_MIN, SATURATION_MAX) };
}

export const isDefaultTuning = (t) => t.hue === HUE_DEFAULT && t.saturation === SATURATION_DEFAULT;

/** Math.Round in .NET: halves go to the even neighbour. */
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const parse = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();

/** Relative luminance like Palette.Luma. */
export const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Palette.Lerp: float maths (t is a C# float), rounded half-to-even. */
function lerp(a, b, t) {
  const tf = Math.fround(clamp(t, 0, 1));
  return a.map((x, i) => roundHalfEven(Math.fround(x + Math.fround((b[i] - x) * tf))));
}

function toHsv([r8, g8, b8]) {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const hue = delta === 0 ? 0 : max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return [(hue + 360) % 360, max === 0 ? 0 : delta / max, max];
}

function fromHsv(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c]][Math.trunc(h / 60)] ?? [c, 0, x];
  const to255 = (value) => roundHalfEven(clamp(value, 0, 1) * 255);
  return [to255(r + m), to255(g + m), to255(b + m)];
}

/** Rotates the hue, scales the saturation, then lifts towards white until as readable as the original
 * (capped at MIN_READABLE_LUMINANCE). '#RRGGBB' in and out. */
export function applyTuning(hex, tuning) {
  if (isDefaultTuning(tuning)) return hex.toUpperCase();
  const original = parse(hex);
  const [h, s, v] = toHsv(original);
  const base = () => fromHsv((h + tuning.hue + 360) % 360, (s * tuning.saturation) / 100, v);
  let tuned = base();
  const target = Math.min(luma(original), MIN_READABLE_LUMINANCE);
  for (let lift = LUMINANCE_STEP; luma(tuned) < target && lift <= 1.0; lift += LUMINANCE_STEP)
    tuned = lerp(base(), [255, 255, 255], lift);
  return toHex(tuned);
}

/** Theme colours that follow the tuning (text and neon borders, as on the desktop). Backgrounds, the yellow-green
 * hover, red, category and urgency colours stay. Keys are CSS custom properties. */
export const TUNED_THEME = Object.freeze({
  '--neon': '#00FF41', '--soft': '#01C432', '--dim': '#029A28', '--done': '#02711D', '--border': '#033B0F', '--border-hi': '#0F5A2A',
});

/** CSS variable → tuned colour, for applying live. */
export const tunedTheme = (tuning) => Object.fromEntries(Object.entries(TUNED_THEME).map(([name, hex]) => [name, applyTuning(hex, tuning)]));
