// Entry point: loads settings and data, wires the controls, owns app state.

import { loadSettings, applyTheme, resolveThemeMode, STATUS_KEYS } from './config.js';
import { loadQueries, normalizeDatabase, normalizeQuery, serializeDatabase, today } from './data.js';
import { filterQueries } from './search.js';
import { renderList } from './render.js';
import { createEditor } from './editor.js';
import * as storage from './storage.js';
import { $, el, clear, copyText } from './dom.js';

const state = {
  settings: null,
  queries: [],
  dirty: false,
  themeMode: 'light',
  filter: { text: '', status: 'all' },
};
let editor = null;

async function init() {
  try {
    state.settings = await loadSettings();
    state.themeMode = resolveThemeMode(storage.getThemePreference());
    applyTheme(state.settings, state.themeMode);
    applySiteText(state.settings);

    const fromFile = await loadQueries();
    const working = storage.getWorkingCopy();
    const workingClean = working ? normalizeDatabase(working) : null;
    // Once the edited copy has been committed, the file matches it and the
    // local copy is no longer needed.
    if (workingClean && JSON.stringify(workingClean) !== JSON.stringify(fromFile)) {
      state.queries = workingClean;
      state.dirty = true;
    } else {
      storage.clearWorkingCopy();
      state.queries = fromFile;
    }
  } catch (err) {
    showError(err);
    return;
  }

  editor = createEditor($('#editor'), state.settings, saveQuery);
  wireControls();
  render();
}

function applySiteText(settings) {
  document.title = settings.siteTitle;
  $('#site-title').textContent = settings.siteTitle;
  $('#tagline').textContent = settings.tagline;
  const link = $('#repo-link');
  if (settings.repoUrl) {
    link.href = `${settings.repoUrl}/edit/${settings.defaultBranch}/data/queries.json`;
    link.hidden = false;
  }
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
  $('#add-btn').addEventListener('click', () => editor.open(null));
  $('#download-btn').addEventListener('click', downloadJson);
  $('#copy-json-btn').addEventListener('click', (e) => copyText(serializeDatabase(state.queries), e.currentTarget));
  $('#discard-btn').addEventListener('click', discardChanges);
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
    onEdit: (q) => editor.open(q),
    onDelete: deleteQuery,
    onTagClick: (tag) => {
      const search = $('#search');
      search.value = tag;
      state.filter.text = tag;
      render();
    },
  });
  $('#result-count').textContent = `${visible.length} of ${state.queries.length} queries`;
  $('#unsaved').hidden = !state.dirty;
  for (const chip of $('#status-filter').children) {
    chip.classList.toggle('active', chip.dataset.status === state.filter.status);
  }
}

function saveQuery(raw) {
  const q = normalizeQuery({ ...raw, updated: today() });
  if (!q) return;
  const index = state.queries.findIndex((x) => x.id === q.id);
  if (index === -1) state.queries.unshift(q);
  else state.queries[index] = q;
  markDirty();
}

function deleteQuery(q) {
  if (!window.confirm(`Delete "${q.title}"?`)) return;
  state.queries = state.queries.filter((x) => x.id !== q.id);
  markDirty();
}

function markDirty() {
  state.dirty = true;
  storage.setWorkingCopy(state.queries);
  render();
}

async function discardChanges() {
  if (!window.confirm('Discard all local changes and reload the published queries?')) return;
  storage.clearWorkingCopy();
  try {
    state.queries = await loadQueries();
  } catch (err) {
    showError(err);
    return;
  }
  state.dirty = false;
  render();
}

function downloadJson() {
  const blob = new Blob([serializeDatabase(state.queries)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'queries.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
