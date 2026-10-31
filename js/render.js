// Builds the query cards: header, code, actions, community votes, comments,
// sample results, lint output. Everything is created with el()/textContent;
// no HTML strings anywhere.

import { el, append, clear, copyText } from './dom.js';
import { highlightKql } from './highlight.js';
import { lintKql } from './lint.js';
import { voteSummary } from './data.js';

// view: { user: {id, username, isAdmin} | null, openCommentsFor: id | '' }
export function renderList(container, queries, settings, handlers, view) {
  clear(container);
  if (queries.length === 0) {
    container.append(el('p', { class: 'empty', text: 'No queries match your search.' }));
    return;
  }
  for (const q of queries) container.append(renderCard(q, settings, handlers, view));
}

function canModify(q, user) {
  return Boolean(user && (user.isAdmin || (q.ownerId && q.ownerId === user.id)));
}

function renderCard(q, settings, handlers, view) {
  const user = view.user;
  const statusLabel = settings.statuses[q.status].label;
  const lintOut = el('ul', { class: 'lint-list', hidden: true });

  const head = el('header', { class: 'card-head' }, [
    el('h2', { class: 'card-title', text: q.title }),
    el('span', { class: `badge status-${q.status}`, text: statusLabel, title: 'Status set by the author' }),
  ]);

  const meta = el('div', { class: 'card-meta' }, [
    ...q.tags.map((tag) => el('button', {
      type: 'button', class: 'tag', text: tag, title: `Search for tag "${tag}"`,
      onClick: () => handlers.onTagClick(tag),
    })),
    el('span', { class: 'byline', text: q.ownerName ? `by @${q.ownerName}` : 'by unknown' }),
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
    canModify(q, user) ? el('button', { type: 'button', class: 'btn', text: 'Edit', onClick: () => handlers.onEdit(q) }) : null,
    canModify(q, user) ? el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', onClick: () => handlers.onDelete(q) }) : null,
  ]);

  const card = el('article', { class: `card status-${q.status}`, dataset: { id: q.id } });
  append(card, [
    head, meta, description, code, actions, lintOut,
    renderVotes(q, user, handlers),
    renderComments(q, user, handlers, view.openCommentsFor === q.id),
    renderSampleResults(q.sampleResults),
  ]);
  return card;
}

function renderVotes(q, user, handlers) {
  const { works, broken, mine } = voteSummary(q, user ? user.id : '');
  const total = works + broken;

  const voteButton = (vote, label, count) => el('button', {
    type: 'button',
    class: `vote vote-${vote}${mine === vote ? ' active' : ''}`,
    title: mine === vote ? 'Click to remove your vote' : (user ? 'Click to vote' : 'Sign in to vote'),
    'aria-pressed': mine === vote ? 'true' : 'false',
    onClick: () => handlers.onVote(q, mine === vote ? null : vote),
  }, [el('span', { class: 'vote-label', text: label }), el('span', { class: 'vote-count', text: String(count) })]);

  const bar = el('div', { class: 'vote-bar', title: total ? `${works} working, ${broken} not working` : 'No votes yet' });
  const fill = el('span', { class: 'vote-bar-fill' });
  fill.style.width = total ? `${Math.round((works / total) * 100)}%` : '0%';
  bar.append(fill);

  let verdict = 'No reports yet';
  if (total > 0 && broken > works) verdict = 'Community reports problems';
  else if (total > 0 && works >= broken) verdict = 'Community confirms it works';

  return el('div', { class: 'community' }, [
    voteButton('works', 'Works for me', works),
    voteButton('broken', 'Not working', broken),
    bar,
    el('span', { class: 'verdict', text: verdict }),
  ]);
}

function renderComments(q, user, handlers, open) {
  const count = q.comments.length;
  const summary = el('summary', { text: `Comments (${count})` });

  const list = el('ul', { class: 'comment-list' }, q.comments.map((c) => el('li', { class: 'comment' }, [
    el('div', { class: 'comment-head' }, [
      el('span', { class: 'comment-author', text: `@${c.author}` }),
      el('time', { class: 'comment-time', datetime: c.createdAt, text: formatTime(c.createdAt) }),
      user && (user.isAdmin || c.userId === user.id)
        ? el('button', { type: 'button', class: 'link-btn', text: 'Delete', onClick: () => handlers.onDeleteComment(q, c) })
        : null,
    ]),
    el('p', { class: 'comment-body', text: c.body }),
  ])));

  let composer;
  if (user) {
    const textarea = el('textarea', {
      class: 'comment-input', rows: 2, maxlength: 4000, required: true,
      placeholder: 'Add a comment: what did not work, which workspace, a fix that helped...',
      'aria-label': 'Comment',
    });
    composer = el('form', {
      class: 'comment-form',
      onSubmit: (event) => {
        event.preventDefault();
        const body = textarea.value.trim();
        if (body) handlers.onComment(q, body);
      },
    }, [textarea, el('button', { type: 'submit', class: 'btn btn-primary', text: 'Post' })]);
    if (open) setTimeout(() => textarea.focus(), 0);
  } else {
    composer = el('button', { type: 'button', class: 'link-btn', text: 'Sign in to comment', onClick: () => handlers.onSignInPrompt() });
  }

  const details = el('details', { class: 'comments' }, [summary, count ? list : el('p', { class: 'muted', text: 'No comments yet.' }), composer]);
  if (open) details.open = true;
  return details;
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso.slice(0, 16);
  }
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
