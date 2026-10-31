// Entry point: loads settings, talks to the database, wires the controls,
// owns app state. Reads are public; writes need a signed-in editor.

import { loadSettings, applyTheme, resolveThemeMode, STATUS_KEYS } from './config.js';
import { normalizeQuery } from './data.js';
import { filterQueries } from './search.js';
import { renderList } from './render.js';
import { createEditor } from './editor.js';
import { createSignInDialog } from './signin.js';
import { createAuth } from './auth.js';
import { createDb } from './db.js';
import * as storage from './storage.js';
import { $, el, clear } from './dom.js';

const state = {
  settings: null,
  queries: [],
  themeMode: 'light',
  filter: { text: '', status: 'all' },
};
let auth = null;
let db = null;
let editor = null;
let signInDialog = null;

async function init() {
  try {
    state.settings = await loadSettings();
    state.themeMode = resolveThemeMode(storage.getThemePreference());
    applyTheme(state.settings, state.themeMode);
    applySiteText(state.settings);
    if (!state.settings.supabase) {
      throw new Error('Add your Supabase "url" and "anonKey" to data/settings.json (see README).');
    }
    auth = createAuth(state.settings.supabase);
    db = createDb(state.settings.supabase);
    await loadData();
  } catch (err) {
    showError(err);
    return;
  }

  editor = createEditor($('#editor'), state.settings, saveQuery);
  signInDialog = createSignInDialog($('#signin'), { onSignIn: signIn, onSignOut: signOut });
  wireControls();
  render();
}

async function loadData() {
  state.queries = await db.list(await auth.getAccessToken());
  setSync(auth.isSignedIn() ? `Signed in as ${auth.email()}.` : 'Read-only. Sign in to add or edit queries.');
}

function applySiteText(settings) {
  document.title = settings.siteTitle;
  $('#site-title').textContent = settings.siteTitle;
  $('#tagline').textContent = settings.tagline;
}

function wireControls() {
  const search = $('#search');
  search.addEventListener('input', () => {
    state.filter.text = search.value;
    render();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !isTyping(event.target)) {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });

  const chips = $('#status-filter');
  clear(chips);
  chips.append(statusChip('all', 'All'));
  for (const key of STATUS_KEYS) chips.append(statusChip(key, state.settings.statuses[key].label));

  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#add-btn').addEventListener('click', () => {
    if (requireSignIn()) editor.open(null);
  });
  $('#signin-btn').addEventListener('click', () => signInDialog.open(auth.email()));

  // Coming back to the tab (for example on another PC) reloads from the database.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

function statusChip(key, label) {
  return el('button', {
    type: 'button',
    class: `chip status-${key}`,
    text: label,
    dataset: { status: key },
    onClick: () => {
      state.filter.status = key;
      render();
    },
  });
}

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function render() {
  const visible = filterQueries(state.queries, state.filter);
  renderList($('#query-list'), visible, state.settings, {
    onEdit: (q) => {
      if (requireSignIn()) editor.open(q);
    },
    onDelete: deleteQuery,
    onTagClick: (tag) => {
      const search = $('#search');
      search.value = tag;
      state.filter.text = tag;
      render();
    },
  });
  $('#result-count').textContent = `${visible.length} of ${state.queries.length} queries`;
  $('#signin-btn').textContent = auth.isSignedIn() ? 'Signed in' : 'Sign in';
  for (const chip of $('#status-filter').children) {
    chip.classList.toggle('active', chip.dataset.status === state.filter.status);
  }
}

function requireSignIn() {
  if (auth.isSignedIn()) return true;
  signInDialog.open('');
  return false;
}

async function signIn(email, password) {
  await auth.signIn(email, password); // throws so the dialog can show the message
  await refresh();
}

async function signOut() {
  await auth.signOut();
  await refresh();
}

async function refresh() {
  try {
    await loadData();
  } catch (err) {
    setSync(`Could not load queries. ${err.message}`, true);
  }
  render();
}

function saveQuery(raw) {
  const q = normalizeQuery(raw);
  if (!q) return;
  write((token) => db.upsert(token, q), 'Saved');
}

function deleteQuery(q) {
  if (!requireSignIn()) return;
  if (!window.confirm(`Delete "${q.title}"?`)) return;
  write((token) => db.remove(token, q.id), 'Deleted');
}

// Runs one write, then reloads the list so this device also picks up
// anything another device changed in the meantime.
async function write(operation, doneWord) {
  if (!requireSignIn()) return;
  setSync('Saving...');
  try {
    const token = await auth.getAccessToken();
    if (!token) {
      setSync('Your session expired. Sign in again.', true);
      render();
      signInDialog.open('');
      return;
    }
    await operation(token);
    state.queries = await db.list(token);
    setSync(`${doneWord} at ${new Date().toLocaleTimeString()}.`);
  } catch (err) {
    setSync(`Save failed. ${err.message}`, true);
  }
  render();
}

function setSync(message, isError = false) {
  const box = $('#sync-status');
  box.textContent = message;
  box.classList.toggle('is-error', isError);
}

function toggleTheme() {
  state.themeMode = state.themeMode === 'dark' ? 'light' : 'dark';
  applyTheme(state.settings, state.themeMode);
  storage.setThemePreference(state.themeMode);
}

function showError(err) {
  console.error(err);
  const box = $('#app-error');
  box.textContent = `Something went wrong: ${err && err.message ? err.message : err}`;
  box.hidden = false;
}

init();
