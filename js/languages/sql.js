// SQL (T-SQL flavored, tolerant of other dialects): tokenizer and heuristic
// syntax checker. It checks structure, clause order, and common slips; it
// does not know your tables, columns, or which dialect features exist.

import {
  createScanner, createReport, significant, checkLexical, checkBrackets, suggest,
} from './shared.js';

// Keywords that can begin a statement.
const STARTERS = new Set([
  'SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'ALTER', 'DROP',
  'TRUNCATE', 'DECLARE', 'SET', 'EXEC', 'EXECUTE', 'USE', 'IF', 'BEGIN', 'END', 'PRINT',
  'GRANT', 'REVOKE', 'DENY', 'RETURN', 'WHILE', 'COMMIT', 'ROLLBACK', 'BACKUP', 'RESTORE',
  'DBCC', 'WAITFOR', 'THROW', 'RAISERROR', 'ELSE', 'OPEN', 'CLOSE', 'FETCH', 'DEALLOCATE',
  'EXPLAIN', 'SHOW', 'DESCRIBE', 'VALUES', 'CALL', 'ANALYZE', 'VACUUM', 'SAVE', 'GOTO',
  'BREAK', 'CONTINUE', 'KILL', 'CHECKPOINT', 'BULK', 'PRAGMA', 'COPY', 'START',
]);

const KEYWORDS = new Set([
  ...STARTERS,
  'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
  'TOP', 'DISTINCT', 'ALL', 'AS', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
  'CROSS', 'NATURAL', 'APPLY', 'UNION', 'INTERSECT', 'EXCEPT', 'INTO', 'AND', 'OR', 'NOT',
  'NULL', 'IS', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ESCAPE', 'CASE', 'WHEN', 'THEN',
  'TABLE', 'VIEW', 'INDEX', 'PROCEDURE', 'PROC', 'FUNCTION', 'TRIGGER', 'DATABASE',
  'SCHEMA', 'COLUMN', 'CONSTRAINT', 'PRIMARY', 'FOREIGN', 'KEY', 'REFERENCES', 'UNIQUE',
  'CHECK', 'DEFAULT', 'IDENTITY', 'ADD', 'OVER', 'PARTITION', 'ROWS', 'RANGE',
  'PRECEDING', 'FOLLOWING', 'UNBOUNDED', 'CURRENT', 'ROW', 'USING', 'MATCHED', 'OUTPUT',
  'NOLOCK', 'TRANSACTION', 'TRAN', 'GO', 'TRY', 'CATCH', 'CURSOR', 'FOR', 'NEXT', 'ONLY',
  'PERCENT', 'TIES', 'PIVOT', 'UNPIVOT', 'RETURNS', 'RETURNING', 'CASCADE', 'TEMP',
  'TEMPORARY', 'ANY', 'SOME', 'TRUE', 'FALSE', 'NOCOUNT', 'OFF',
]);

const TYPES = new Set([
  'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'BIT', 'DECIMAL', 'NUMERIC', 'FLOAT',
  'REAL', 'DOUBLE', 'MONEY', 'CHAR', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'TEXT', 'NTEXT',
  'DATE', 'DATETIME', 'DATETIME2', 'SMALLDATETIME', 'DATETIMEOFFSET', 'TIME', 'TIMESTAMP',
  'UNIQUEIDENTIFIER', 'VARBINARY', 'BINARY', 'XML', 'BOOLEAN', 'SERIAL', 'JSON', 'UUID',
]);

// Keywords that are also ordinary functions when followed by "(".
const FUNCTION_LIKE = new Set(['LEFT', 'RIGHT', 'REPLACE', 'IF']);

const CLAUSE_RANK = { FROM: 1, WHERE: 2, GROUP: 3, HAVING: 4, ORDER: 5 };
const CLAUSE_LABEL = { GROUP: 'GROUP BY', ORDER: 'ORDER BY' };
const SET_OPERATORS = new Set(['UNION', 'INTERSECT', 'EXCEPT']);
const PREDICATE_CLAUSES = new Set(['WHERE', 'ON', 'HAVING', 'WHEN']);
const JOIN_END = new Set([
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL', 'WHERE', 'GROUP', 'ORDER',
  'HAVING', 'UNION', 'INTERSECT', 'EXCEPT',
]);
const INCOMPLETE_ENDERS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'ON', 'BY', 'JOIN', 'SET', 'INTO',
  'VALUES', 'HAVING', 'IN', 'LIKE', 'BETWEEN', 'AS', 'UNION', 'ORDER', 'GROUP', 'WHEN',
  'THEN', 'IS', 'INSERT', 'UPDATE', 'DELETE', 'TOP', 'DISTINCT', 'INNER', 'LEFT', 'RIGHT',
  'FULL', 'OUTER', 'CROSS', 'CASE',
]);

const MULTI_OPS = ['<>', '!=', '<=', '>=', '||', '::', '+=', '-=', '*=', '/='];
const ONE_CHAR_OPS = '=<>+-*/%!&|^~';
const PUNCT = '(),;.:?$[]{}\\';
const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_$#]/;
const DIGIT = /[0-9]/;

export function tokenize(src) {
  const s = createScanner(src);
  const n = src.length;

  while (s.pos < n) {
    if (s.whitespace()) continue;
    const i = s.pos;
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '-' && next === '-') { s.push('comment', s.lineEnd()); continue; }
    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close === -1) s.push('comment', n, { unterminated: true });
      else s.push('comment', close + 2);
      continue;
    }

    // Strings: '...' with '' as an escaped quote, optional N prefix.
    if (ch === "'" || ((ch === 'N' || ch === 'n') && next === "'")) {
      const start = ch === "'" ? i : i + 1;
      s.string(start, "'", { doubling: true, multiline: true });
      continue;
    }
    // Quoted identifiers: "name", `name`, [name]
    if (ch === '"' || ch === '`') { s.string(i, ch, { doubling: true, type: 'ident' }); continue; }
    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      const newline = src.indexOf('\n', i);
      if (close !== -1 && (newline === -1 || newline > close)) { s.push('ident', close + 1); continue; }
    }

    if (DIGIT.test(ch) || (ch === '.' && next !== undefined && DIGIT.test(next))) {
      let j;
      if (ch === '0' && (next === 'x' || next === 'X')) {
        j = s.run(/[0-9a-fA-F]/, i + 2);
      } else {
        j = s.run(DIGIT, i);
        if (src[j] === '.') j = s.run(DIGIT, j + 1);
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] || '')) j = s.run(DIGIT, j + 2);
      }
      s.push('number', j);
      continue;
    }

    // Variables (@x, @@rowcount) and temp tables (#t, ##t)
    if (ch === '@' && (next === '@' || WORD_START.test(next || ''))) {
      s.push('variable', s.run(WORD_CHAR, s.run(/@/, i)));
      continue;
    }
    if (ch === '#' && (next === '#' || WORD_START.test(next || ''))) {
      s.push('ident', s.run(WORD_CHAR, s.run(/#/, i)));
      continue;
    }

    if (WORD_START.test(ch)) {
      const j = s.run(WORD_CHAR, i + 1);
      s.push(classifyWord(src.slice(i, j).toUpperCase(), src, j), j);
      continue;
    }

    const two = src.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) { s.push('operator', i + 2); continue; }
    if (ONE_CHAR_OPS.includes(ch)) { s.push('operator', i + 1); continue; }
    if (PUNCT.includes(ch) || ch === '@' || ch === '#') { s.push('punct', i + 1); continue; }
    s.push('unknown', i + 1);
  }
  return s.tokens;
}

function classifyWord(upper, src, end) {
  let k = end;
  while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k += 1;
  const followedByParen = src[k] === '(';
  if (TYPES.has(upper)) return 'type';
  if (KEYWORDS.has(upper)) return followedByParen && FUNCTION_LIKE.has(upper) ? 'function' : 'keyword';
  return followedByParen ? 'function' : 'ident';
}

const kw = (t) => (t && t.type === 'keyword' ? t.text.toUpperCase() : '');
const isPunct = (t, text) => Boolean(t) && t.type === 'punct' && t.text === text;

export function lint(src) {
  const report = createReport();
  if (!src || !src.trim()) {
    report.error('Script is empty.');
    return report.finish();
  }
  const all = tokenize(src);
  checkLexical(all, report);
  const toks = significant(all);
  checkBrackets(toks, report, { '(': ')' });
  for (const statement of splitStatements(toks)) checkStatement(statement, report);
  return report.finish();
}

// Statements end at ';' (outside parentheses) or at a GO batch separator.
function splitStatements(toks) {
  const statements = [];
  let current = [];
  let depth = 0;
  for (const t of toks) {
    if (isPunct(t, '(')) depth += 1;
    else if (isPunct(t, ')')) depth = Math.max(0, depth - 1);
    if (depth === 0 && (isPunct(t, ';') || kw(t) === 'GO')) {
      if (current.length) statements.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  if (current.length) statements.push(current);
  return statements;
}

function checkStatement(tokens, report) {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const firstWord = first.text.toUpperCase();

  if (['keyword', 'ident', 'function', 'type'].includes(first.type) && !STARTERS.has(firstWord)) {
    const suggestion = suggest(firstWord, STARTERS);
    if (suggestion) report.error(`Unknown statement '${first.text}'. Did you mean ${suggestion}?`, first);
    else if (first.type === 'keyword') report.error(`A statement cannot start with '${first.text}'.`, first);
    // Other identifiers may be stored procedure calls; leave them alone.
  }

  // "SET NOCOUNT ON" style options legitimately end in ON.
  const isSetOption = firstWord === 'SET' && kw(last) === 'ON';
  if (!isSetOption && (INCOMPLETE_ENDERS.has(kw(last)) || (last.type === 'operator' && last.text !== '*'))) {
    report.error(`Statement is incomplete after '${last.text}'.`, last);
  }

  const items = nest(tokens);
  checkScope(items, report, '');

  const topKeywords = items.map(kw);
  if (firstWord === 'UPDATE' && topKeywords.includes('SET') && !topKeywords.includes('WHERE')) {
    report.warn('UPDATE has no WHERE clause, so it changes every row.', first);
  }
  if (firstWord === 'DELETE' && !topKeywords.includes('WHERE')) {
    report.warn('DELETE has no WHERE clause, so it removes every row.', first);
  }
}

// Turns a flat token list into a tree: each (...) becomes one group item.
function nest(tokens) {
  const root = [];
  const stack = [root];
  for (const t of tokens) {
    if (isPunct(t, '(')) {
      const group = { type: 'group', text: '(', line: t.line, col: t.col, items: [] };
      stack[stack.length - 1].push(group);
      stack.push(group.items);
    } else if (isPunct(t, ')')) {
      if (stack.length > 1) stack.pop();
    } else {
      stack[stack.length - 1].push(t);
    }
  }
  return root;
}

// Checks one nesting level; clause is the clause the parent scope was in.
function checkScope(items, report, clause) {
  let lastRank = 0;
  let lastClause = '';

  for (let i = 0; i < items.length; i += 1) {
    const t = items[i];
    const next = items[i + 1];
    if (t.type === 'group') { checkScope(t.items, report, clause); continue; }

    if (isPunct(t, ',')) {
      const nextWord = kw(next);
      if (!next) report.error('Trailing comma.', t);
      else if (isPunct(next, ',')) report.error('Double comma.', next);
      else if (CLAUSE_RANK[nextWord] || SET_OPERATORS.has(nextWord)) report.error(`Trailing comma before ${nextWord}.`, t);
      continue;
    }

    if (t.type === 'operator' && ['=', '!=', '<>'].includes(t.text) && kw(next) === 'NULL' && PREDICATE_CLAUSES.has(clause)) {
      report.warn(`Comparing with '${t.text} NULL' is never true. Use IS NULL or IS NOT NULL.`, t);
      continue;
    }

    const word = kw(t);
    if (!word) continue;

    if (STARTERS.has(word) || SET_OPERATORS.has(word)) lastRank = 0;
    if (word === 'SELECT') {
      clause = 'SELECT';
      if (kw(next) === 'FROM') report.error('SELECT list is empty.', t);
    }

    if (CLAUSE_RANK[word]) {
      const isDistinctFrom = word === 'FROM' && kw(items[i - 1]) === 'DISTINCT' && ['IS', 'NOT'].includes(kw(items[i - 2]));
      if (!isDistinctFrom) {
        if (CLAUSE_RANK[word] < lastRank) {
          report.error(`${CLAUSE_LABEL[word] || word} must come before ${lastClause}.`, t);
        } else {
          lastRank = CLAUSE_RANK[word];
          lastClause = CLAUSE_LABEL[word] || word;
        }
        clause = word;
      }
    } else if (['SET', 'ON', 'VALUES', 'WHEN', 'THEN'].includes(word)) {
      clause = word;
    }

    if ((word === 'GROUP' || word === 'ORDER') && kw(next) !== 'BY') {
      report.error(`${word} must be followed by BY.`, t);
    }
    if (word === 'JOIN') {
      clause = 'FROM';
      checkJoin(items, i, report);
    }
  }
}

function checkJoin(items, i, report) {
  const before = kw(items[i - 1]);
  if (before === 'CROSS' || before === 'NATURAL') return;
  for (let j = i + 1; j < items.length; j += 1) {
    const word = kw(items[j]);
    if (word === 'ON' || word === 'USING') return;
    if (JOIN_END.has(word)) break;
  }
  report.warn('JOIN has no ON clause.', items[i]);
}
