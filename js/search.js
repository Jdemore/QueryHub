// Search and filtering. Every whitespace-separated term must appear somewhere
// in the title, description, code, tags, language, or platform (case-insensitive).

import { getLanguage, platformLabel } from './languages/index.js';

export function filterQueries(queries, { text = '', status = 'all', language = 'all', tags = [] } = {}) {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  return queries.filter((q) => {
    if (status !== 'all' && q.status !== status) return false;
    if (language !== 'all' && q.language !== language) return false;
    // Selected tags narrow the list: an entry must carry all of them.
    if (!tags.every((tag) => q.tags.includes(tag))) return false;
    if (terms.length === 0) return true;
    const haystack = searchText(q);
    return terms.every((term) => haystack.includes(term));
  });
}

function searchText(q) {
  return [
    q.title, q.description, q.query, q.tags.join(' '),
    getLanguage(q.language).label, platformLabel(q.language, q.platform),
  ].join('\n').toLowerCase();
}
