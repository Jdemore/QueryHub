// Builds the query cards, sample-result tables, and lint message lists.
// Everything is created with el()/textContent; no HTML strings anywhere.

import { el, append, clear, copyText } from './dom.js';
import { highlightKql } from './highlight.js';
import { lintKql } from './lint.js';

export function renderList(container, queries, settings, handlers) {
  clear(container);
  if (queries.length === 0) {
    container.append(el('p', { class: 'empty', text: 'No queries match your search.' }));
    return;
  }
  for (const q of queries) container.append(renderCard(q, settings, handlers));
}

function renderCard(q, settings, handlers) {
  const statusLabel = settings.statuses[q.status].label;
  const lintOut = el('ul', { class: 'lint-list', hidden: true });

  const head = el('header', { class: 'card-head' }, [
    el('h2', { class: 'card-title', text: q.title }),
    el('span', { class: `badge status-${q.status}`, text: statusLabel }),
  ]);

  const meta = el('div', { class: 'card-meta' }, [
    ...q.tags.map((tag) => el('button', {
      type: 'button', class: 'tag', text: tag, title: `Search for tag "${tag}"`,
      onClick: () => handlers.onTagClick(tag),
    })),
    q.updated ? el('span', { class: 'updated', text: `Updated ${q.updated}` }) : null,
  ]);

  const description = q.description ? el('p', { class: 'card-desc', text: q.description }) : null;

  const code = el('pre', { class: 'code-block' }, [
    el('code', { class: 'kql' }, [highlightKql(q.query)]),
  ]);

  const actions = el('div', { class: 'card-actions' }, [
    el('button', { type: 'button', class: 'btn', text: 'Copy query', onClick: (e) => copyText(q.query, e.currentTarget) }),
    el('button', {
      type: 'button', class: 'btn', text: 'Check syntax',
      onClick: () => {
        renderLintMessages(lintOut, lintKql(q.query));
        lintOut.hidden = false;
      },
    }),
    el('button', { type: 'button', class: 'btn', text: 'Edit', onClick: () => handlers.onEdit(q) }),
    el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', onClick: () => handlers.onDelete(q) }),
  ]);

  const card = el('article', { class: `card status-${q.status}`, dataset: { id: q.id } });
  append(card, [head, meta, description, code, actions, lintOut, renderSampleResults(q.sampleResults)]);
  return card;
}

function renderSampleResults(sample) {
  if (!sample) return null;
  const rowCount = sample.rows.length;
  const summary = el('summary', { text: `Sample results (${rowCount} ${rowCount === 1 ? 'row' : 'rows'})` });
  let body;
  if (rowCount === 0) {
    body = el('p', { class: 'muted', text: 'No rows returned.' });
  } else {
    body = el('div', { class: 'table-wrap' }, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, sample.columns.map((c) => el('th', { text: c })))]),
        el('tbody', {}, sample.rows.map((row) => el('tr', {}, row.map((cell) => el('td', { text: cell }))))),
      ]),
    ]);
  }
  return el('details', { class: 'results' }, [summary, body]);
}

export function renderLintMessages(container, messages) {
  clear(container);
  if (messages.length === 0) {
    container.append(el('li', { class: 'lint-ok', text: 'No problems found. (Heuristic check: table and column names are not validated.)' }));
    return;
  }
  for (const m of messages) {
    container.append(el('li', { class: `lint-${m.severity}`, text: `Line ${m.line}, col ${m.col}: ${m.message}` }));
  }
}
