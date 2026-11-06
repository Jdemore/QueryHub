// KQL (Kusto Query Language): tokenizer and heuristic syntax checker.
// The checker is not the real Kusto parser: it catches structural mistakes
// (brackets, strings, pipes, unknown operators, incomplete clauses, typos)
// but cannot validate table or column names.

import {
  createScanner, createReport, significant, checkLexical, checkBrackets,
  trackDepth, suggest, WHITESPACE,
} from './shared.js';

// Operators that may follow a pipe.
const TABULAR_OPERATORS = new Set([
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
const SOURCE_OPERATORS = new Set([
  'union', 'search', 'find', 'print', 'range', 'datatable', 'externaldata', 'evaluate',
]);

// Tabular operators that are complete with no arguments.
const STANDALONE_OPERATORS = new Set(['count', 'getschema', 'serialize', 'consume', 'distinct']);

const RENDER_TYPES = new Set([
  'anomalychart', 'areachart', 'barchart', 'card', 'columnchart', 'ladderchart',
  'linechart', 'piechart', 'pivotchart', 'scatterchart', 'stackedareachart',
  'table', 'timechart', 'timepivot', 'treemap',
]);

const KEYWORDS = new Set([
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

const TYPES = new Set([
  'bool', 'boolean', 'datetime', 'date', 'dynamic', 'guid', 'uuid', 'int', 'long',
  'real', 'double', 'decimal', 'string', 'timespan', 'time',
]);

// Keywords that are legitimately followed by "(" and should keep keyword styling.
const PAREN_KEYWORDS = new Set([
  'in', '!in', 'in~', '!in~', 'has_any', 'has_all', 'datatable', 'externaldata',
  'typeof', 'union', 'print', 'range', 'evaluate', 'invoke', 'render', 'where',
  'extend', 'project', 'summarize', 'take', 'limit', 'top', 'sort', 'order', 'join',
  'lookup', 'parse', 'distinct', 'search', 'find', 'facet', 'fork', 'partition',
]);

// A segment ending in one of these is missing its right-hand side.
const INCOMPLETE_ENDERS = new Set([
  'by', 'on', 'and', 'or', 'not', 'in', '!in', 'in~', '!in~', 'has', '!has', 'has_cs',
  'has_any', 'has_all', 'contains', '!contains', 'startswith', '!startswith',
  'endswith', '!endswith', 'matches', 'regex', 'between', 'kind', 'with', 'step',
  'from', 'to', 'hint',
]);

// Platform hints: which time column each platform's native tables use.
const DEFENDER_TABLE = /^(Device[A-Z]|Email[A-Z]|Identity[A-Z]|CloudAppEvents|AlertInfo|AlertEvidence|UrlClickEvents|Behavior[A-Z])/;
const SENTINEL_TABLES = new Set([
  'SigninLogs', 'AADNonInteractiveUserSignInLogs', 'AADServicePrincipalSignInLogs',
  'AADManagedIdentitySignInLogs', 'AuditLogs', 'SecurityEvent', 'SecurityAlert',
  'SecurityIncident', 'AzureActivity', 'AzureDiagnostics', 'AzureMetrics', 'Heartbeat',
  'Syslog', 'CommonSecurityLog', 'OfficeActivity', 'Perf', 'Event', 'Usage',
  'ThreatIntelligenceIndicator', 'W3CIISLog', 'DnsEvents', 'WindowsFirewall',
]);

const TWO_CHAR_OPS = ['==', '!=', '=~', '!~', '<=', '>=', '=>', '..'];
const ONE_CHAR_OPS = '=<>+-*/%!';
const PUNCT = '(),;:{}[].';
const IDENT_START = /[A-Za-z_$]/;
const IDENT_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

export function tokenize(src) {
  const s = createScanner(src);
  const n = src.length;

  while (s.pos < n) {
    if (s.whitespace()) continue;
    const i = s.pos;
    const ch = src[i];
    const next = src[i + 1];

    // Line comment
    if (ch === '/' && next === '/') { s.push('comment', s.lineEnd()); continue; }

    // Multi-line string ```...```
    if (src.startsWith('```', i)) {
      const close = src.indexOf('```', i + 3);
      if (close === -1) s.push('string', n, { unterminated: true });
      else s.push('string', close + 3);
      continue;
    }

    // String literals: "..", '..', @"..", h"..", h@"..", H'..'
    const prefix = stringPrefixLength(src, i);
    if (prefix !== -1) {
      const verbatim = src.slice(i, i + prefix).includes('@');
      s.string(i + prefix, src[i + prefix], verbatim ? { doubling: true } : { escape: '\\' });
      continue;
    }

    // Bracketed identifier: ['column name'] or ["column name"]
    if (ch === '[' && (next === "'" || next === '"')) {
      const close = src.indexOf(next + ']', i + 2);
      const newline = src.indexOf('\n', i);
      if (close !== -1 && (newline === -1 || newline > close)) {
        s.push('ident', close + 2);
        continue;
      }
    }

    // Numbers (including timespan literals like 1h, 30m, 7d and hex)
    if (DIGIT.test(ch) || (ch === '.' && next !== undefined && DIGIT.test(next))) {
      let j = i;
      if (ch === '0' && (next === 'x' || next === 'X')) {
        j = s.run(/[0-9a-fA-F]/, i + 2);
      } else {
        j = s.run(DIGIT, j);
        if (src[j] === '.' && DIGIT.test(src[j + 1] || '')) j = s.run(DIGIT, j + 1);
        if ((src[j] === 'e' || src[j] === 'E') && /[0-9+-]/.test(src[j + 1] || '')) j = s.run(DIGIT, j + 2);
        j = s.run(/[a-zA-Z]/, j); // unit suffix
      }
      s.push('number', j);
      continue;
    }

    // Identifiers, keywords, operators like mv-expand, negated keywords like !has
    if (IDENT_START.test(ch) || (ch === '!' && next !== undefined && /[a-z]/.test(next))) {
      let j = s.run(IDENT_CHAR, i + 1);
      // Glue hyphenated operators (project-away, mv-expand, ...)
      while (src[j] === '-' && /[a-z]/.test(src[j + 1] || '')) {
        const k = s.run(/[a-z]/, j + 1);
        const candidate = src.slice(i, k);
        if (TABULAR_OPERATORS.has(candidate) || KEYWORDS.has(candidate)) j = k;
        else break;
      }
      // Glue "~" for in~ / !in~
      if (src[j] === '~' && KEYWORDS.has(src.slice(i, j + 1))) j += 1;
      const word = src.slice(i, j);
      s.push(word === '!' ? 'operator' : classifyWord(word, src, j), j);
      continue;
    }

    if (ch === '|') { s.push('pipe', i + 1); continue; }
    if (TWO_CHAR_OPS.includes(src.slice(i, i + 2))) { s.push('operator', i + 2); continue; }
    if (ONE_CHAR_OPS.includes(ch)) { s.push('operator', i + 1); continue; }
    if (PUNCT.includes(ch)) { s.push('punct', i + 1); continue; }
    s.push('unknown', i + 1);
  }
  return s.tokens;
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
  while (k < src.length && src[k] !== '\n' && WHITESPACE.test(src[k])) k += 1;
  const followedByParen = src[k] === '(';
  if (TYPES.has(word)) return followedByParen ? 'function' : 'type';
  if (TABULAR_OPERATORS.has(word) || KEYWORDS.has(word)) {
    if (followedByParen && !PAREN_KEYWORDS.has(word)) return 'function';
    return 'keyword';
  }
  if (followedByParen) return 'function';
  return 'ident';
}

// Returns [{ severity: 'error' | 'warning', message, line, col }].
export function lint(src, { platform = '' } = {}) {
  const report = createReport();
  if (!src || !src.trim()) {
    report.error('Query is empty.');
    return report.finish();
  }

  const all = tokenize(src);
  checkLexical(all, report);
  const toks = significant(all);
  checkBrackets(toks, report);

  const statements = splitStatements(toks);
  statements.forEach((stmt, index) => checkStatement(stmt, index === statements.length - 1, report));
  checkPlatform(toks, platform, report);
  return report.finish();
}

// Statements are separated by ';' at bracket depth 0.
function splitStatements(toks) {
  const statements = [];
  let current = [];
  let depth = 0;
  for (const t of toks) {
    if (t.type === 'punct' && t.text === ';' && depth === 0) {
      statements.push({ tokens: current, terminated: true });
      current = [];
      continue;
    }
    depth = trackDepth(t, depth);
    current.push(t);
  }
  if (current.length) statements.push({ tokens: current, terminated: false });
  return statements.filter((s) => s.tokens.length > 0);
}

function checkStatement({ tokens, terminated }, isLast, report) {
  const first = tokens[0];
  if (first.type === 'keyword' && first.text === 'let') {
    if (!terminated) report.error("'let' statement must end with ';'.", first);
    else if (isLast) report.error("Query ends after a 'let' statement; add the query that uses it.", first);
    const name = tokens[1];
    const eq = tokens[2];
    if (!name || name.type !== 'ident' || !eq || eq.text !== '=') {
      report.error("Expected 'let <name> = <expression>'.", first);
      return;
    }
    const body = tokens.slice(3);
    if (body.length === 0) report.error(`'let ${name.text}' has no value.`, eq);
    else if (splitPipes(body).length > 1) checkPipeline(body, report);
    else checkNested(body, report);
    return;
  }
  if (first.type === 'keyword' && (first.text === 'set' || first.text === 'declare')) return;
  checkPipeline(tokens, report);
}

function splitPipes(tokens) {
  const segments = [{ pipe: null, tokens: [] }];
  let depth = 0;
  for (const t of tokens) {
    if (t.type === 'pipe' && depth === 0) {
      segments.push({ pipe: t, tokens: [] });
      continue;
    }
    depth = trackDepth(t, depth);
    segments[segments.length - 1].tokens.push(t);
  }
  return segments;
}

const isWord = (t) => t.type === 'ident' || t.type === 'keyword' || t.type === 'function';

function checkPipeline(tokens, report) {
  const segments = splitPipes(tokens);
  const source = segments[0];

  if (source.tokens.length === 0) {
    report.error("Query cannot start with '|'. Start with a table name.", segments[1] ? segments[1].pipe : tokens[0]);
  } else {
    const head = source.tokens[0];
    const startsWithParen = head.type === 'punct' && head.text === '(';
    if (isWord(head) && TABULAR_OPERATORS.has(head.text) && !SOURCE_OPERATORS.has(head.text)) {
      report.error(`A query cannot start with the '${head.text}' operator. Start with a table name, for example 'SigninLogs | ${head.text} ...'.`, head);
    } else if (!isWord(head) && head.type !== 'type' && !startsWithParen) {
      report.error('A query must start with a table name or a source operator such as union, print, or datatable.', head);
    } else if (SOURCE_OPERATORS.has(head.text)) {
      checkOperatorArgs(source.tokens, report);
    }
    checkNested(source.tokens, report);
  }

  for (const seg of segments.slice(1)) {
    if (seg.tokens.length === 0) {
      report.error("Empty pipe segment: nothing follows '|'.", seg.pipe);
      continue;
    }
    const op = seg.tokens[0];
    if (!isWord(op) || !TABULAR_OPERATORS.has(op.text)) {
      const suggestion = isWord(op) ? suggest(op.text, TABULAR_OPERATORS) : null;
      report.error(`Unknown operator '${op.text}' after '|'.` + (suggestion ? ` Did you mean '${suggestion}'?` : ''), op);
    } else {
      checkOperatorArgs(seg.tokens, report);
    }
    checkNested(seg.tokens, report);
  }
}

function checkOperatorArgs(seg, report) {
  const op = seg[0];
  const name = op.text;
  const args = seg.slice(1);
  const last = seg[seg.length - 1];
  const hasKeyword = (word) => args.some((t) => t.type === 'keyword' && t.text === word);

  if (args.length === 0) {
    if (!STANDALONE_OPERATORS.has(name)) report.error(`'${name}' needs arguments.`, op);
    return;
  }
  if (name === 'count') {
    report.warn("'count' takes no arguments. To count per group use 'summarize count() by ...'.", args[0]);
    return;
  }

  if (last.type === 'punct' && last.text === ',') {
    report.error('Trailing comma.', last);
  } else if ((last.type === 'keyword' && INCOMPLETE_ENDERS.has(last.text)) || last.type === 'operator') {
    report.error(`Expression is incomplete after '${last.text}'.`, last);
  }

  if (name === 'where' || name === 'filter') {
    for (const t of args) {
      if (t.type === 'operator' && t.text === '=') {
        report.warn("Single '=' is assignment in KQL. Use '==' to compare values.", t);
      }
    }
  }
  if (name === 'take' || name === 'limit' || name === 'sample') {
    if (args[0].type !== 'number' && args[0].type !== 'ident') {
      report.error(`'${name}' expects a row count, for example '${name} 100'.`, args[0]);
    }
  }
  if ((name === 'sort' || name === 'order' || name === 'top') && !hasKeyword('by')) {
    report.error(`'${name}' requires a 'by' clause.`, op);
  }
  if ((name === 'join' || name === 'lookup') && !hasKeyword('on')) {
    report.warn(`'${name}' is missing an 'on' clause.`, op);
  }
  if (name === 'render' && !RENDER_TYPES.has(args[0].text)) {
    report.warn(`'${args[0].text}' is not a known chart type (try timechart, barchart, piechart, table).`, args[0]);
  }
}

// Recurse into parenthesized sub-queries such as join (T | where ...) on x.
function checkNested(tokens, report) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type !== 'punct') continue;
    if (t.text === '(') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (t.text === ')') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const inner = tokens.slice(start + 1, i);
        if (splitPipes(inner).length > 1) checkPipeline(inner, report);
        else checkNested(inner, report);
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
}

// Sentinel (Log Analytics) tables use TimeGenerated; Defender advanced
// hunting tables use Timestamp. Mixing them up returns nothing or errors.
function checkPlatform(toks, platform, report) {
  if (!platform) return;
  const idents = toks.filter((t) => t.type === 'ident');
  const find = (name) => idents.find((t) => t.text === name);
  if (platform === 'defender') {
    const column = find('TimeGenerated');
    const table = idents.find((t) => DEFENDER_TABLE.test(t.text));
    if (column && table && !find('Timestamp')) {
      report.warn(`Defender hunting tables such as '${table.text}' use Timestamp. TimeGenerated is the Sentinel column.`, column);
    }
  } else if (platform === 'sentinel') {
    const column = find('Timestamp');
    const table = idents.find((t) => SENTINEL_TABLES.has(t.text));
    if (column && table && !find('TimeGenerated')) {
      report.warn(`Sentinel tables such as '${table.text}' use TimeGenerated, not Timestamp.`, column);
    }
  }
}
