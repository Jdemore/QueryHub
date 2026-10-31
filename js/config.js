// Loads data/settings.json, validates it, and applies it as CSS custom
// properties. Values from the JSON are checked before touching the DOM.

export const SETTINGS_URL = 'data/settings.json';
export const STATUS_KEYS = ['works', 'mostly', 'broken'];

const DEFAULT_STATUSES = {
  works: { label: 'Fully works', color: '#1f8a4c' },
  mostly: { label: 'Mostly works', color: '#c98a00' },
  broken: { label: "Doesn't work", color: '#c8352e' },
};

export async function loadSettings() {
  const res = await fetch(SETTINGS_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${SETTINGS_URL} (HTTP ${res.status})`);
  return normalizeSettings(await res.json());
}

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const statuses = {};
  for (const key of STATUS_KEYS) {
    const entry = (s.statuses && s.statuses[key]) || {};
    statuses[key] = {
      label: str(entry.label, DEFAULT_STATUSES[key].label, 40),
      color: cssValue(entry.color, DEFAULT_STATUSES[key].color),
    };
  }
  const theme = s.theme && typeof s.theme === 'object' ? s.theme : {};
  return {
    siteTitle: str(s.siteTitle, 'QueryHub', 60),
    tagline: str(s.tagline, '', 120),
    supabase: supabaseConfig(s.supabase),
    fontFamily: cssValue(s.fontFamily, 'system-ui, sans-serif'),
    monoFontFamily: cssValue(s.monoFontFamily, 'Consolas, Menlo, monospace'),
    baseFontSize: cssValue(s.baseFontSize, '15px'),
    codeFontSize: cssValue(s.codeFontSize, '13px'),
    statuses,
    theme: {
      light: palette(theme.light),
      dark: palette(theme.dark),
    },
  };
}

function palette(raw) {
  const out = { syntax: {} };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'syntax') {
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (isName(k) && isSafeCss(v)) out.syntax[k] = v;
        }
      }
    } else if (isName(key) && isSafeCss(value)) {
      out[key] = value;
    }
  }
  return out;
}

function str(value, fallback, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
}

function isName(key) {
  return /^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key);
}

// Reject anything that could smuggle a URL or break out of a declaration.
function isSafeCss(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && !/[;{}<>\\]|url\(|expression\(|@import/i.test(value);
}

function cssValue(value, fallback) {
  return isSafeCss(value) ? value : fallback;
}

// Returns { url, anonKey } or null when not configured. The URL is pinned to
// *.supabase.co to match the page's Content-Security-Policy.
function supabaseConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '';
  const anonKey = typeof raw.anonKey === 'string' ? raw.anonKey.trim() : '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return null;
  if (!/^[A-Za-z0-9._-]{20,}$/.test(anonKey)) return null;
  return { url, anonKey };
}

const kebab = (name) => name.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());

// Writes the chosen palette, fonts, and status colors onto :root.
// CSSOM writes via setProperty are allowed under a strict CSP.
export function applyTheme(settings, mode) {
  const root = document.documentElement;
  const pal = settings.theme[mode] || settings.theme.light;
  const set = (name, value) => root.style.setProperty(name, value);

  for (const [key, value] of Object.entries(pal)) {
    if (key !== 'syntax') set(`--${kebab(key)}`, value);
  }
  for (const [key, value] of Object.entries(pal.syntax)) {
    set(`--syntax-${kebab(key)}`, value);
  }
  for (const key of STATUS_KEYS) {
    set(`--status-${key}`, settings.statuses[key].color);
  }
  set('--font-family', settings.fontFamily);
  set('--mono-font-family', settings.monoFontFamily);
  set('--base-font-size', settings.baseFontSize);
  set('--code-font-size', settings.codeFontSize);
  root.dataset.theme = mode;
}

export function resolveThemeMode(stored) {
  if (stored === 'light' || stored === 'dark') return stored;
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}
