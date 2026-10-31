// localStorage wrapper. Every call is wrapped in try/catch because storage
// can be blocked (private windows, strict settings) and the site must still work.

const KEYS = {
  session: 'queryhub.session',
  theme: 'queryhub.theme',
};

function read(key) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable; the in-memory state still works for this session.
  }
}

// Supabase auth session for this browser.
export function getSession() {
  const s = read(KEYS.session);
  if (!s || typeof s !== 'object') return null;
  if (typeof s.accessToken !== 'string' || typeof s.refreshToken !== 'string') return null;
  if (typeof s.expiresAt !== 'number') return null;
  return { accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt, email: String(s.email || '') };
}
export const setSession = (session) => write(KEYS.session, session);

export function getThemePreference() {
  const value = read(KEYS.theme);
  return value === 'light' || value === 'dark' ? value : null;
}
export const setThemePreference = (mode) => write(KEYS.theme, mode);
