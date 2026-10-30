// Lightweight KQL syntax checker. It is heuristic, not the real Kusto parser:
// it catches structural mistakes (brackets, strings, pipes, unknown operators,
// incomplete clauses, common typos) but cannot validate table or column names.
// Returns [{ severity: 'error' | 'warning', message, line, col }].

import {
  tokenize, significant, TABULAR_OPERATORS, SOURCE_OPERATORS,
  STANDALONE_OPERATORS, RENDER_TYPES,
} from './tokenizer.js';

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = { ')': '(', ']': '[', '}': '{' };

// A segment ending in one of these is missing its right-hand side.
const INCOMPLETE_ENDERS = new Set([
  'by', 'on', 'and', 'or', 'not', 'in', '!in', 'in~', '!in~', 'has', '!has', 'has_cs',
  'has_any', 'has_all', 'contains', '!contains', 'startswith', '!startswith',
  'endswith', '!endswith', 'matches', 'regex', 'between', 'kind', 'with', 'step',
  'from', 'to', 'hint',
]);

export function lintKql(src) {
  const messages = [];
  const add = (severity, message, tok) => {
    messages.push({ severity, message, line: tok ? tok.line : 1, col: tok ? tok.col : 1 });
  };

  if (!src || !src.trim()) {
    add('error', 'Query is empty.');
    return messages;
  }

  const all = tokenize(src);
  for (const t of all) {
    if (t.unterminated) add('error', 'Unterminated string literal.', t);
    if (t.type === 'unknown') add('error', `Unexpected character '${t.text}'.`, t);
  }

  const toks = significant(all);
  checkBrackets(toks, add);

  const statements = splitStatements(toks);
  statements.forEach((stmt, index) => checkStatement(stmt, index === statements.length - 1, add));

  return dedupe(messages).sort((a, b) => a.line - b.line || a.col - b.col);
}

function checkBrackets(toks, add) {
  const stack = [];
  for (const t of toks) {
    if (t.type !== 'punct') continue;
    if (OPEN[t.text]) {
      stack.push(t);
    } else if (CLOSE[t.text]) {
      const open = stack.pop();
      if (!open) add('error', `Unexpected '${t.text}' with no matching '${CLOSE[t.text]}'.`, t);
      else if (OPEN[open.text] !== t.text) {
        add('error', `Mismatched brackets: '${open.text}' at line ${open.line} is closed by '${t.text}'.`, t);
      }
    }
  }
  for (const open of stack) add('error', `Unclosed '${open.text}'.`, open);
}

function trackDepth(t, depth) {
  if (t.type !== 'punct') return depth;
  if (OPEN[t.text]) return depth + 1;
  if (CLOSE[t.text]) return Math.max(0, depth - 1);
  return depth;
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

function checkStatement({ tokens, terminated }, isLast, add) {
  const first = tokens[0];
  if (first.type === 'keyword' && first.text === 'let') {
    if (!terminated) add('error', "'let' statement must end with ';'.", first);
    else if (isLast) add('error', "Query ends after a 'let' statement; add the query that uses it.", first);
    const name = tokens[1];
    const eq = tokens[2];
    if (!name || name.type !== 'ident' || !eq || eq.text !== '=') {
      add('error', "Expected 'let <name> = <expression>'.", first);
      return;
    }
    const body = tokens.slice(3);
    if (body.length === 0) add('error', `'let ${name.text}' has no value.`, eq);
    else if (splitPipes(body).length > 1) checkPipeline(body, add);
    else checkNested(body, add);
    return;
  }
  if (first.type === 'keyword' && (first.text === 'set' || first.text === 'declare')) return;
  checkPipeline(tokens, add);
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

function checkPipeline(tokens, add) {
  const segments = splitPipes(tokens);
  const source = segments[0];

  if (source.tokens.length === 0) {
    add('error', "Query cannot start with '|'. Start with a table name.", segments[1] ? segments[1].pipe : tokens[0]);
  } else {
    const head = source.tokens[0];
    const startsWithParen = head.type === 'punct' && head.text === '(';
    if (isWord(head) && TABULAR_OPERATORS.has(head.text) && !SOURCE_OPERATORS.has(head.text)) {
      add('error', `A query cannot start with the '${head.text}' operator. Start with a table name, for example 'SigninLogs | ${head.text} ...'.`, head);
    } else if (!isWord(head) && head.type !== 'type' && !startsWithParen) {
      add('error', 'A query must start with a table name or a source operator such as union, print, or datatable.', head);
    } else if (SOURCE_OPERATORS.has(head.text)) {
      checkOperatorArgs(source.tokens, add);
    }
    checkNested(source.tokens, add);
  }

  for (const seg of segments.slice(1)) {
    if (seg.tokens.length === 0) {
      add('error', "Empty pipe segment: nothing follows '|'.", seg.pipe);
      continue;
    }
    const op = seg.tokens[0];
    if (!isWord(op) || !TABULAR_OPERATORS.has(op.text)) {
      const suggestion = isWord(op) ? suggest(op.text) : null;
      add('error', `Unknown operator '${op.text}' after '|'.` + (suggestion ? ` Did you mean '${suggestion}'?` : ''), op);
    } else {
      checkOperatorArgs(seg.tokens, add);
    }
    checkNested(seg.tokens, add);
  }
}

function checkOperatorArgs(seg, add) {
  const op = seg[0];
  const name = op.text;
  const args = seg.slice(1);
  const last = seg[seg.length - 1];

  if (args.length === 0) {
    if (!STANDALONE_OPERATORS.has(name)) add('error', `'${name}' needs arguments.`, op);
    return;
  }
  if (name === 'count') {
    add('warning', "'count' takes no arguments. To count per group use 'summarize count() by ...'.", args[0]);
    return;
  }

  if (last.type === 'punct' && last.text === ',') {
    add('error', 'Trailing comma.', last);
  } else if ((last.type === 'keyword' && INCOMPLETE_ENDERS.has(last.text)) || last.type === 'operator') {
    add('error', `Expression is incomplete after '${last.text}'.`, last);
  }

  if (name === 'where' || name === 'filter') {
    for (const t of args) {
      if (t.type === 'operator' && t.text === '=') {
        add('warning', "Single '=' is assignment in KQL. Use '==' to compare values.", t);
      }
    }
  }
  if (name === 'take' || name === 'limit' || name === 'sample') {
    if (args[0].type !== 'number' && args[0].type !== 'ident') {
      add('error', `'${name}' expects a row count, for example '${name} 100'.`, args[0]);
    }
  }
  if ((name === 'sort' || name === 'order' || name === 'top') && !hasKeyword(args, 'by')) {
    add('error', `'${name}' requires a 'by' clause.`, op);
  }
  if ((name === 'join' || name === 'lookup') && !hasKeyword(args, 'on')) {
    add('warning', `'${name}' is missing an 'on' clause.`, op);
  }
  if (name === 'render' && !RENDER_TYPES.has(args[0].text)) {
    add('warning', `'${args[0].text}' is not a known chart type (try timechart, barchart, piechart, table).`, args[0]);
  }
}

function hasKeyword(tokens, word) {
  return tokens.some((t) => t.type === 'keyword' && t.text === word);
}

// Recurse into parenthesized sub-queries such as join (T | where ...) on x.
function checkNested(tokens, add) {
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
        if (splitPipes(inner).length > 1) checkPipeline(inner, add);
        else checkNested(inner, add);
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
}

function suggest(word) {
  const lower = word.toLowerCase();
  let best = null;
  let bestDist = lower.length <= 4 ? 1 : 2;
  for (const candidate of TABULAR_OPERATORS) {
    const d = levenshtein(lower, candidate);
    if (d <= bestDist && (best === null || d < bestDist)) {
      best = candidate;
      bestDist = d;
      if (d === 0) break;
    }
  }
  return best;
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

function dedupe(messages) {
  const seen = new Set();
  return messages.filter((m) => {
    const key = `${m.line}:${m.col}:${m.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
