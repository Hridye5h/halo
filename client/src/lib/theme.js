/**
 * Theme runtime.
 *
 * Applying a theme is a single attribute write; a custom theme additionally
 * writes its variables inline, which override the stylesheet by specificity.
 * There is no re-render involved, so theme switching is free at any tree size.
 */

export const THEMES = [
  { id: 'midnight', name: 'Midnight', swatch: ['#0a0a0f', '#7c5cff', '#f2f2f7'] },
  { id: 'chess', name: 'Chess', swatch: ['#161512', '#7fa650', '#f0ece4'] },
  { id: 'galaxy', name: 'Galaxy', swatch: ['#06060f', '#5b8cff', '#a855f7'] },
  { id: 'cyberpunk', name: 'Cyberpunk', swatch: ['#0b0410', '#ff2e88', '#00f5d4'] },
  { id: 'forest', name: 'Forest', swatch: ['#0b120e', '#4ade80', '#e8f2ea'] },
  { id: 'sakura', name: 'Sakura', swatch: ['#fff7f9', '#e8578c', '#2c1c24'] },
];

/** The keys a custom theme may set. Anything else is ignored, so a shared
 *  theme code can never inject arbitrary CSS. */
export const CUSTOM_KEYS = [
  'bg-base', 'bg-surface', 'bg-elevated', 'bg-inset', 'bg-hover',
  'text-primary', 'text-secondary', 'text-muted',
  'accent', 'accent-hover', 'accent-soft', 'accent-contrast',
  'line', 'line-strong',
  'success', 'warn', 'danger',
  'bubble-me', 'bubble-me-text', 'bubble-them', 'bubble-them-text',
  'app-bg', 'glow',
];

const SAFE_VALUE = /^[#a-zA-Z0-9\s,.()%-]+$/;

export function applyTheme({ theme, customTheme, density, reducedMotion }) {
  const root = document.documentElement;

  root.dataset.theme = theme === 'custom' ? 'midnight' : (theme || 'midnight');
  root.dataset.density = density || 'comfortable';
  root.dataset.motion = reducedMotion ? 'reduced' : 'full';

  // Always clear first: switching from custom back to a preset must not leave
  // the old inline overrides winning.
  CUSTOM_KEYS.forEach((key) => root.style.removeProperty(`--${key}`));

  if (theme === 'custom' && customTheme?.colors) {
    for (const [key, value] of Object.entries(customTheme.colors)) {
      if (!CUSTOM_KEYS.includes(key)) continue;
      if (typeof value !== 'string' || !SAFE_VALUE.test(value)) continue;
      root.style.setProperty(`--${key}`, value);
    }
  }
}

/* ---------------------------------------------------------------------------
 * Contrast checking.
 *
 * A theme you cannot read is a bug, not a style choice. Custom themes are
 * checked against WCAG AA before they can be saved.
 * ------------------------------------------------------------------------ */

function parseHex(hex) {
  const clean = hex.replace('#', '').trim();
  if (![3, 6].includes(clean.length)) return null;
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) return null;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @returns {number|null} contrast ratio, or null if either colour is not a
 *  plain hex (gradients are skipped rather than guessed at). */
export function contrastRatio(foreground, background) {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return null;

  const light = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const dark = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (light + 0.05) / (dark + 0.05);
}

export function validateCustomTheme(colors) {
  const problems = [];

  const pairs = [
    ['text-primary', 'bg-base', 4.5, 'Body text on the app background'],
    ['text-primary', 'bg-surface', 4.5, 'Body text on panels'],
    ['text-secondary', 'bg-surface', 3, 'Secondary text on panels'],
    ['accent-contrast', 'accent', 4.5, 'Text on accent buttons'],
  ];

  for (const [fgKey, bgKey, minimum, label] of pairs) {
    const ratio = contrastRatio(colors[fgKey], colors[bgKey]);
    if (ratio === null) continue;
    if (ratio < minimum) {
      problems.push({
        label,
        ratio: Math.round(ratio * 100) / 100,
        required: minimum,
      });
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Themes are shareable: base64 of the colour object, so a friend can paste
 *  a code and get the exact look. */
export function encodeTheme(theme) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(theme))));
}

export function decodeTheme(code) {
  try {
    const parsed = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
    if (!parsed?.colors || typeof parsed.colors !== 'object') return null;
    return {
      name: String(parsed.name ?? 'Shared theme').slice(0, 40),
      colors: Object.fromEntries(
        Object.entries(parsed.colors).filter(([k]) => CUSTOM_KEYS.includes(k)),
      ),
    };
  } catch {
    return null;
  }
}
