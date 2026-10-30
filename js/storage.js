// localStorage wrapper. Every call is wrapped in try/catch because storage
// can be blocked (private windows, strict settings) and the site must still work.

const KEYS = {
  working: 'queryhub.working',
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

// The "working copy" is the edited query list that has not been committed yet.
export const getWorkingCopy = () => read(KEYS.working);
export const setWorkingCopy = (queries) => write(KEYS.working, queries);
export const clearWorkingCopy = () => write(KEYS.working, null);

export function getThemePreference() {
  const value = read(KEYS.theme);
  return value === 'light' || value === 'dark' ? value : null;
}
export const setThemePreference = (mode) => write(KEYS.theme, mode);
