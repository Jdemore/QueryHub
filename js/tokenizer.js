// KQL tokenizer shared by the highlighter and the syntax checker.
// Produces tokens of the form { type, text, line, col, unterminated? }.
// Types: ws, comment, string, number, ident, keyword, type, function,
//        pipe, operator, punct, unknown.

// Operators that may follow a pipe.
export const TABULAR_OPERATORS = new Set([
  'as', 'consume', 'count', 'distinct', 'evaluate', 'extend', 'facet', 'find',
  'fork', 'getschema', 'invoke', 'join', 'limit', 'lookup', 'make-series',
  'mv-apply', 'mv-expand', 'order', 'parse', 'parse-where', 'parse-kv',
  'partition', 'project', 'project-away', 'project-keep', 'project-rename',
  'project-reorder', 'reduce', 'render', 'sample', 'sample-distinct', 'scan',
  'search', 'serialize', 'sort', 'summarize', 'take', 'top', 'top-hitters',
  'top-nested', 'union', 'where', 'filter', 'make-graph', 'graph-match',
  'graph-to-table', 'graph-shortest-paths', 'graph-mark-components',
]);

// Operators that can begin a query without a table name in front of them.
export const SOURCE_OPERATORS = new Set([
  'union', 'search', 'find', 'print', 'range', 'datatable', 'externaldata', 'evaluate',
]);

// Tabular operators that are complete with no arguments.
export const STANDALONE_OPERATORS = new Set(['count', 'getschema', 'serialize', 'consume', 'distinct']);

export const RENDER_TYPES = new Set([
  'anomalychart', 'areachart', 'barchart', 'card', 'columnchart', 'ladderchart',
  'linechart', 'piechart', 'pivotchart', 'scatterchart', 'stackedareachart',
  'table', 'timechart', 'timepivot', 'treemap',
]);

export const KEYWORDS = new Set([
  'let', 'set', 'by', 'on', 'kind', 'and', 'or', 'not', 'in', '!in', 'in~', '!in~',
  'has', '!has', 'has_cs', '!has_cs', 'has_any', 'has_all', 'hasprefix', '!hasprefix',
  'hassuffix', '!hassuffix', 'contains', '!contains', 'contains_cs', '!contains_cs',
  'startswith', '!startswith', 'startswith_cs', '!startswith_cs',
  'endswith', '!endswith', 'endswith_cs', '!endswith_cs',
  'matches', 'regex', 'between', '!between', 'asc', 'desc', 'nulls', 'first', 'last',
  'with', 'step', 'from', 'to', 'true', 'false', 'null', 'hint', 'withsource',
  'isfuzzy', 'leftouter', 'rightouter', 'inner', 'innerunique', 'fullouter',
  'leftanti', 'rightanti', 'leftsemi', 'rightsemi', 'anti', 'semi',
  'declare', 'query_parameters', 'typeof', 'default', 'of', 'where', 'others',
  'top-nested', 'bagexpansion', 'array', 'bag',
  'print', 'range', 'datatable', 'externaldata',
]);

export const TYPES = new Set([
  'bool', 'boolean', 'datetime', 'date', 'dynamic', 'guid', 'uuid', 'int', 'long',
  'real', 'double', 'decimal', 'string', 'timespan', 'time',
]);

// Keywords that are legitimately followed by "(" and should keep keyword styling.
const PAREN_KEYWORDS = new Set([
  'in', '!in', 'in~', '!in~', 'has_any', 'has_all', 'datatable', 'externaldata',
  'typeof', 'union', 'print', 'range', 'evaluate', 'invoke', 'render', 'where', 'extend', 'project', 'summarize', 'take', 'limit', 'top', 'sort', 'order', 'join', 'lookup', 'parse', 'distinct', 'search', 'find', 'facet', 'fork', 'partition',
]);

const TWO_CHAR_OPS = ['==', '!=', '=~', '!~', '<=', '>=', '=>', '..'];
const ONE_CHAR_OPS = '=<>+-*/%!';
const PUNCT = '(),;:{}[].';
const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (type, end, extra) => {
    const text = src.slice(i, end);
    const tok = { type, text, line, col };
    if (extra) Object.assign(tok, extra);
    tokens.push(tok);
    for (const ch of text) {
      if (ch === '\n') { line += 1; col = 1; } else { col += 1; }
    }
    i = end;
    return tok;
  };

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      let j = i + 1;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j += 1;
      push('ws', j);
      continue;
    }

    // Line comment
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') j += 1;
      push('comment', j);
      continue;
    }

    // Multi-line string ```...```
    if (src.startsWith('```', i)) {
      const close = src.indexOf('```', i + 3);
      if (close === -1) push('string', n, { unterminated: true });
      else push('string', close + 3);
      continue;
    }

    // String literals: "..", '..', @"..", h"..", h@"..", H'..'
    const strStart = stringPrefixLength(src, i);
    if (strStart !== -1) {
      const verbatim = src.slice(i, i + strStart).includes('@');
      const quote = src[i + strStart];
      let j = i + strStart + 1;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === '\n') break;
        if (!verbatim && c === '\\') { j += 2; continue; }
        if (c === quote) {
          if (verbatim && src[j + 1] === quote) { j += 2; continue; }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      push('string', Math.min(j, n), closed ? null : { unterminated: true });
      continue;
    }

    // Bracketed identifier: ['column name'] or ["column name"]
    if (ch === '[' && (next === "'" || next === '"')) {
      const close = src.indexOf(next + ']', i + 2);
      const newline = src.indexOf('\n', i);
      if (close !== -1 && (newline === -1 || newline > close)) {
        push('ident', close + 2);
        continue;
      }
    }

    // Numbers (including timespan literals like 1h, 30m, 7d and hex)
    if (DIGIT.test(ch) || (ch === '.' && next !== undefined && DIGIT.test(next))) {
      let j = i;
      if (ch === '0' && (next === 'x' || next === 'X')) {
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(src[j])) j += 1;
      } else {
        while (j < n && DIGIT.test(src[j])) j += 1;
        if (src[j] === '.' && DIGIT.test(src[j + 1] || '')) {
          j += 1;
          while (j < n && DIGIT.test(src[j])) j += 1;
        }
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] || '')) {
          j += 2;
          while (j < n && DIGIT.test(src[j])) j += 1;
        }
        while (j < n && /[a-zA-Z]/.test(src[j])) j += 1; // unit suffix
      }
      push('number', j);
      continue;
    }

    // Identifiers, keywords, operators like mv-expand, negated keywords like !has
    if (IDENT_START.test(ch) || (ch === '!' && next !== undefined && /[a-z]/.test(next))) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(src[j])) j += 1;
      // Glue hyphenated operators (project-away, mv-expand, ...)
      while (src[j] === '-' && /[a-z]/.test(src[j + 1] || '')) {
        let k = j + 1;
        while (k < n && /[a-z]/.test(src[k])) k += 1;
        const candidate = src.slice(i, k);
        if (TABULAR_OPERATORS.has(candidate) || KEYWORDS.has(candidate)) j = k;
        else break;
      }
      // Glue "~" for in~ / !in~
      if (src[j] === '~' && KEYWORDS.has(src.slice(i, j + 1))) j += 1;
      const word = src.slice(i, j);
      if (word === '!') { push('operator', j); continue; }
      push(classifyWord(word, src, j), j);
      continue;
    }

    // Pipe
    if (ch === '|') { push('pipe', i + 1); continue; }

    // Operators
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) { push('operator', i + 2); continue; }
    if (ONE_CHAR_OPS.includes(ch)) { push('operator', i + 1); continue; }

    // Punctuation
    if (PUNCT.includes(ch)) { push('punct', i + 1); continue; }

    push('unknown', i + 1);
  }
  return tokens;
}

function stringPrefixLength(src, i) {
  let j = i;
  if (src[j] === 'h' || src[j] === 'H') j += 1;
  if (src[j] === '@') j += 1;
  if (src[j] === '"' || src[j] === "'") return j - i;
  return -1;
}

function classifyWord(word, src, end) {
  let k = end;
  while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k += 1;
  const followedByParen = src[k] === '(';
  if (TYPES.has(word)) return followedByParen ? 'function' : 'type';
  if (TABULAR_OPERATORS.has(word) || KEYWORDS.has(word)) {
    if (followedByParen && !PAREN_KEYWORDS.has(word)) return 'function';
    return 'keyword';
  }
  if (followedByParen) return 'function';
  return 'ident';
}

// Drops whitespace and comments.
export function significant(tokens) {
  return tokens.filter((t) => t.type !== 'ws' && t.type !== 'comment');
}
