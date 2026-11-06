// Entry point: loads settings, talks to the database, wires the controls,
// owns app state. Reads are public; writes need a signed-in account.

import { loadSettings, applyTheme, resolveThemeMode, STATUS_KEYS } from './config.js';
import { normalizeQuery } from './data.js';
import { LANGUAGES, LANGUAGE_KEYS } from './languages/index.js';
import { filterQueries } from './search.js';
import { renderList } from './render.js';
import { createEditor } from './editor.js';
import { createAccountDialog } from './account.js';
import { createAuth } from './auth.js';
import { createDb } from './db.js';
import * as storage from './storage.js';
import { $, el, clear } from './dom.js';

const state = {
  settings: null,
  queries: [],
  user: null, // { id, username, isAdmin } when signed in
  themeMode: 'light',
  filter: { text: '', status: 'all', language: 'all', tags: [] },
  openCommentsFor: '',
};
let auth = null;
let db = null;
let editor = null;
let accountDialog = null;

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
    await loadUser();
    await loadData();
  } catch (err) {
    showError(err);
    return;
  }

  editor = createEditor($('#editor'), state.settings, saveQuery);
  accountDialog = createAccountDialog($('#account'), { onSignIn: signIn, onSignUp: signUp, onSignOut: signOut });
  wireControls();
  render();
}

async function loadUser() {
  state.user = null;
  const token = await auth.getAccessToken();
  if (!token) return;
  state.user = await db.profile(token, auth.userId());
  if (!state.user) {
    // Session exists but no profile row (for example the account was deleted).
    await auth.signOut();
  }
}

async function loadData() {
  state.queries = await db.list(await auth.getAccessToken());
  setSync(state.user ? `Signed in as @${state.user.username}.` : 'Read-only. Sign in to add queries, vote, or comment.');
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

  buildChips($('#language-filter'), 'language', [
    ['all', 'All languages'],
    ...LANGUAGE_KEYS.map((key) => [key, LANGUAGES[key].label]),
  ]);
  buildChips($('#status-filter'), 'status', [
    ['all', 'Any status'],
    ...STATUS_KEYS.map((key) => [key, state.settings.statuses[key].label]),
  ]);

  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#add-btn').addEventListener('click', () => {
    if (requireSignIn()) editor.open(null);
  });
  $('#account-btn').addEventListener('click', () => accountDialog.open(state.user));

  // Coming back to the tab (for example on another PC) reloads from the database.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

// Fills a chip group. field is the state.filter key the chips control.
function buildChips(container, field, entries) {
  clear(container);
  for (const [key, label] of entries) {
    container.append(el('button', {
      type: 'button',
      class: `chip ${field}-${key}`,
      text: label,
      dataset: { value: key },
      onClick: () => {
        state.filter[field] = key;
        render();
      },
    }));
  }
}

// Tags are a multi-select filter: clicking one adds it, clicking again removes it.
function toggleTag(tag) {
  const tags = state.filter.tags;
  state.filter.tags = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
  render();
}

// Shows the selected tags in the filter bar so they can be removed even
// when no card is left to click on.
function renderTagFilter() {
  const box = $('#tag-filter');
  clear(box);
  box.hidden = state.filter.tags.length === 0;
  for (const tag of state.filter.tags) {
    box.append(el('button', {
      type: 'button',
      class: 'chip tag-chip active',
      text: tag,
      title: `Stop filtering by "${tag}"`,
      onClick: () => toggleTag(tag),
    }));
  }
  if (state.filter.tags.length > 1) {
    box.append(el('button', {
      type: 'button',
      class: 'link-btn',
      text: 'Clear tags',
      onClick: () => {
        state.filter.tags = [];
        render();
      },
    }));
  }
}

function markActiveChip(container, value) {
  for (const chip of container.children) {
    chip.classList.toggle('active', chip.dataset.value === value);
  }
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
    onVote: vote,
    onComment: addComment,
    onDeleteComment: deleteComment,
    onSignInPrompt: () => requireSignIn(),
    onTagClick: toggleTag,
  }, { user: state.user, openCommentsFor: state.openCommentsFor, activeTags: state.filter.tags });
  renderTagFilter();
  state.openCommentsFor = '';
  $('#result-count').textContent = `${visible.length} of ${state.queries.length} entries`;
  $('#account-btn').textContent = state.user ? `@${state.user.username}` : 'Sign in';
  markActiveChip($('#language-filter'), state.filter.language);
  markActiveChip($('#status-filter'), state.filter.status);
}

function requireSignIn() {
  if (state.user) return true;
  accountDialog.open(null);
  return false;
}

async function signIn(identifier, pin) {
  await auth.signIn(identifier, pin); // throws so the dialog can show the message
  await loadUser();
  await refresh();
}

async function signUp(username, pin, inviteCode) {
  const name = username.trim().toLowerCase();
  if (await db.usernameTaken(name)) throw new Error('That username is already taken.');
  await auth.signUp(name, pin, inviteCode);
  await loadUser();
  await refresh();
}

async function signOut() {
  await auth.signOut();
  state.user = null;
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
  const existing = state.queries.find((x) => x.id === q.id);
  write((token) => (existing ? db.updateQuery(token, q) : db.insertQuery(token, q, state.user.id)), 'Saved');
}

function deleteQuery(q) {
  if (!requireSignIn()) return;
  if (!window.confirm(`Delete "${q.title}"?`)) return;
  write((token) => db.deleteQuery(token, q.id), 'Deleted');
}

function vote(q, value) {
  if (!requireSignIn()) return;
  // Flagging something as broken opens the thread so the reason can be added.
  if (value === 'broken') state.openCommentsFor = q.id;
  write((token) => db.setVote(token, q.id, state.user.id, value), value ? 'Vote saved' : 'Vote removed');
}

function addComment(q, body) {
  if (!requireSignIn()) return;
  state.openCommentsFor = q.id;
  write((token) => db.addComment(token, q.id, state.user.id, body), 'Comment posted');
}

function deleteComment(q, comment) {
  if (!requireSignIn()) return;
  if (!window.confirm('Delete this comment?')) return;
  state.openCommentsFor = q.id;
  write((token) => db.deleteComment(token, comment.id), 'Comment deleted');
}

// Runs one write, then reloads the list so this device also picks up
// anything another device changed in the meantime.
async function write(operation, doneWord) {
  if (!requireSignIn()) return;
  setSync('Saving...');
  try {
    const token = await auth.getAccessToken();
    if (!token) {
      state.user = null;
      setSync('Your session expired. Sign in again.', true);
      render();
      accountDialog.open(null);
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
