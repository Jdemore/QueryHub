// Search and filtering. Every whitespace-separated term must appear somewhere
// in the title, description, query text, or tags (case-insensitive).

export function filterQueries(queries, { text = '', status = 'all' } = {}) {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  return queries.filter((q) => {
    if (status !== 'all' && q.status !== status) return false;
    if (terms.length === 0) return true;
    const haystack = searchText(q);
    return terms.every((term) => haystack.includes(term));
  });
}

function searchText(q) {
  return [q.title, q.description, q.query, q.tags.join(' ')].join('\n').toLowerCase();
}
