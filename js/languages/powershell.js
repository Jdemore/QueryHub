// PowerShell (.ps1): tokenizer and heuristic syntax checker. It checks
// structure and the mistakes people bring from other languages (==, =, >
// in conditions, "else if"); it does not know which cmdlets exist.

import {
  createScanner, createReport, significant, checkLexical, checkBrackets,
  suggest, isSmartQuote,
} from './shared.js';

const KEYWORDS = new Set([
  'if', 'elseif', 'else', 'foreach', 'for', 'while', 'do', 'until', 'switch', 'function',
  'filter', 'param', 'begin', 'process', 'end', 'return', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'trap', 'class', 'enum', 'using', 'in', 'exit',
  'dynamicparam', 'workflow', 'parallel', 'sequence', 'inlinescript',
]);

// Comparison and other dash operators (without the dash, lowercase).
const BASE_OPERATORS = [
  'eq', 'ne', 'gt', 'ge', 'lt', 'le', 'like', 'notlike', 'match', 'notmatch',
  'contains', 'notcontains', 'in', 'notin', 'replace', 'split', 'join',
];
const OPERATORS = new Set([
  ...BASE_OPERATORS,
  ...BASE_OPERATORS.map((op) => 'c' + op),
  ...BASE_OPERATORS.map((op) => 'i' + op),
  'and', 'or', 'xor', 'not', 'band', 'bor', 'bxor', 'bnot', 'shl', 'shr',
  'is', 'isnot', 'as', 'f',
]);
const LONG_OPERATORS = BASE_OPERATORS.filter((op) => op.length >= 4);

// What people type when they mean a real operator.
const WRONG_OPERATORS = {
  equals: '-eq', equal: '-eq', notequals: '-ne', notequal: '-ne', neq: '-ne',
  greater: '-gt', greaterthan: '-gt', less: '-lt', lessthan: '-lt',
  gte: '-ge', lte: '-le', isnull: "-eq $null",
};
const C_STYLE_OPERATORS = { '==': '-eq', '!=': '-ne', '<=': '-le', '>=': '-ge' };

const CONDITION_KEYWORDS = new Set(['if', 'elseif', 'while']);
const BLOCK_KEYWORDS = new Set(['else', 'try', 'finally', 'do']);
const TYPO_KEYWORDS = ['function', 'foreach', 'param', 'return', 'switch', 'elseif', 'while', 'catch', 'finally', 'throw'];

const MULTI_OPS = ['2>&1', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '++', '--', '::', '..', '>>', '2>'];
const ONE_CHAR_OPS = '=+-*/%!<>&?~^@$:';
const BRACKET_CHARS = '(){}[]';
const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const HORIZONTAL_SPACE = /[ \t]/;

export function tokenize(src) {
  const s = createScanner(src);
  const n = src.length;

  while (s.pos < n) {
    if (s.whitespace()) continue;
    const i = s.pos;
    const ch = src[i];
    const next = src[i + 1];

    // Backtick line continuation
    if (ch === '`' && (next === '\n' || next === '\r')) { s.push('ws', i + 1); continue; }

    if (ch === '<' && next === '#') {
      const close = src.indexOf('#>', i + 2);
      if (close === -1) s.push('comment', n, { unterminated: true });
      else s.push('comment', close + 2);
      continue;
    }
    if (ch === '#') { s.push('comment', s.lineEnd()); continue; }

    // Here-strings: @" ... "@ and @' ... '@ (terminator at the start of a line)
    if (ch === '@' && (next === '"' || next === "'") && /^[ \t]*\r?\n/.test(src.slice(i + 2, i + 200))) {
      const close = src.indexOf('\n' + next + '@', i + 2);
      if (close === -1) s.push('string', n, { unterminated: true });
      else s.push('string', close + 3);
      continue;
    }
    if (ch === "'") { s.string(i, "'", { doubling: true, multiline: true }); continue; }
    if (ch === '"') { s.string(i, '"', { escape: '`', doubling: true, multiline: true }); continue; }

    // Variables: $name, $env:PATH, $script:x, ${any name}, $_, $?, $$
    if (ch === '$') {
      if (next === '{') {
        const close = src.indexOf('}', i + 2);
        s.push('variable', close === -1 ? n : close + 1);
        continue;
      }
      if (WORD_START.test(next || '')) {
        let j = s.run(WORD_CHAR, i + 1);
        if (src[j] === ':' && WORD_START.test(src[j + 1] || '')) j = s.run(WORD_CHAR, j + 1);
        s.push('variable', j);
        continue;
      }
      if (next === '_' || next === '?' || next === '$' || next === '^') { s.push('variable', i + 2); continue; }
    }

    if (DIGIT.test(ch) && !src.startsWith('2>', i)) {
      let j;
      if (ch === '0' && (next === 'x' || next === 'X')) {
        j = s.run(/[0-9a-fA-F]/, i + 2);
      } else {
        j = s.run(DIGIT, i);
        if (src[j] === '.' && DIGIT.test(src[j + 1] || '')) j = s.run(DIGIT, j + 1);
        j = s.run(/[a-zA-Z]/, j); // kb, mb, gb, l, d
      }
      s.push('number', j);
      continue;
    }

    // Words, including Verb-Noun cmdlet names
    if (WORD_START.test(ch)) {
      let j = s.run(WORD_CHAR, i + 1);
      while (src[j] === '-' && WORD_START.test(src[j + 1] || '')) j = s.run(WORD_CHAR, j + 1);
      const word = src.slice(i, j);
      let type = 'ident';
      if (KEYWORDS.has(word.toLowerCase())) type = 'keyword';
      else if (word.includes('-') || src[s.run(HORIZONTAL_SPACE, j)] === '(') type = 'function';
      s.push(type, j);
      continue;
    }

    // -eq style operators and -Parameter names (only after a space or bracket)
    if (ch === '-' && WORD_START.test(next || '') && (i === 0 || /[\s(\[{,;|]/.test(src[i - 1]))) {
      const j = s.run(WORD_CHAR, i + 1);
      s.push(OPERATORS.has(src.slice(i + 1, j).toLowerCase()) ? 'operator' : 'type', j);
      continue;
    }

    if (ch === '|' && next !== '|') { s.push('pipe', i + 1); continue; }
    const multi = MULTI_OPS.find((op) => src.startsWith(op, i));
    if (multi) { s.push('operator', i + multi.length); continue; }
    if (ONE_CHAR_OPS.includes(ch)) { s.push('operator', i + 1); continue; }
    // Brackets and everything else (paths, separators) are plain punctuation.
    s.push(isSmartQuote(ch) ? 'unknown' : 'punct', i + 1);
  }
  return s.tokens;
}

const isPunct = (t, text) => Boolean(t) && t.type === 'punct' && t.text === text;
const keyword = (t) => (t && t.type === 'keyword' ? t.text.toLowerCase() : '');
const isValue = (t) => Boolean(t) && (['variable', 'number', 'string', 'ident'].includes(t.type) || isPunct(t, ')') || isPunct(t, ']'));

export function lint(src) {
  const report = createReport();
  if (!src || !src.trim()) {
    report.error('Script is empty.');
    return report.finish();
  }
  const all = tokenize(src);
  checkLexical(all, report, { smartQuoteSeverity: 'warning' });
  const toks = significant(all).filter((t) => BRACKET_CHARS.includes(t.text) || t.type !== 'punct' || t.text === ';' || t.text === ',' || t.text === '.');
  checkBrackets(toks, report);

  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    const prev = toks[i - 1];
    const next = toks[i + 1];

    if (t.type === 'operator' && C_STYLE_OPERATORS[t.text]) {
      report.error(`PowerShell has no '${t.text}' operator. Use ${C_STYLE_OPERATORS[t.text]}.`, t);
    }

    if (t.type === 'type' && isValue(prev)) {
      const name = t.text.slice(1).toLowerCase();
      if (Object.hasOwn(WRONG_OPERATORS, name)) {
        report.error(`'${t.text}' is not a PowerShell operator. Use ${WRONG_OPERATORS[name]}.`, t);
      }
    }

    if (t.type === 'pipe') {
      if (!next) report.error("Pipeline ends with '|': nothing follows it.", t);
      else if (next.type === 'pipe') report.error("Empty pipe segment: nothing between the two '|'.", next);
    }

    const word = keyword(t);
    // Keywords used as property names, parameter values, or pipeline aliases are not statements.
    const isStatement = word && !(prev && (prev.type === 'pipe' || prev.type === 'type' || isPunct(prev, '.') || (prev.type === 'operator' && prev.text === '::')));
    if (isStatement) checkKeyword(toks, i, word, report);

    if (t.type === 'ident' && t.text.length >= 4 && (!prev || prev.line !== t.line) && next && (next.type === 'ident' || next.type === 'function' || isPunct(next, '(') || isPunct(next, '{'))) {
      const suggestion = suggest(t.text, TYPO_KEYWORDS, 1);
      if (suggestion) report.warn(`'${t.text}' is not a PowerShell keyword. Did you mean '${suggestion}'?`, t);
    }
  }
  return report.finish();
}

function checkKeyword(toks, i, word, report) {
  const t = toks[i];
  const next = toks[i + 1];

  if (CONDITION_KEYWORDS.has(word)) {
    if (!isPunct(next, '(')) {
      report.error(`'${t.text}' must be followed by a condition in parentheses.`, t);
      return;
    }
    checkCondition(toks, i + 1, report);
    return;
  }
  if (word === 'else' && keyword(next) === 'if') {
    report.error("PowerShell uses 'elseif' as one word, not 'else if'.", t);
    return;
  }
  if (BLOCK_KEYWORDS.has(word) && !isPunct(next, '{')) {
    report.error(`'${t.text}' must be followed by '{'.`, t);
  }
  if (word === 'catch' && !isPunct(next, '{') && !isPunct(next, '[')) {
    report.error("'catch' must be followed by '{' or an exception type in brackets.", t);
  }
  if (word === 'function' && !(next && (next.type === 'ident' || next.type === 'function'))) {
    report.error("'function' must be followed by a name.", t);
  }
}

// Looks at the top level of a condition: if ( ... ). Assignments wrapped in
// their own parentheses are a deliberate idiom, so nested levels are skipped.
function checkCondition(toks, openIndex, report) {
  let depth = 0;
  for (let j = openIndex; j < toks.length; j += 1) {
    const t = toks[j];
    if (t.type === 'punct' && '([{'.includes(t.text)) { depth += 1; continue; }
    if (t.type === 'punct' && ')]}'.includes(t.text)) {
      depth -= 1;
      if (depth === 0) return;
      continue;
    }
    if (depth !== 1) continue;

    if (t.type === 'operator' && t.text === '=') {
      report.warn("'=' assigns a value. Use -eq to compare.", t);
    } else if (t.type === 'operator' && (t.text === '>' || t.text === '<')) {
      report.warn(`'${t.text}' is redirection in PowerShell. Use ${t.text === '>' ? '-gt' : '-lt'} to compare.`, t);
    } else if (t.type === 'type' && isValue(toks[j - 1])) {
      const name = t.text.slice(1).toLowerCase();
      if (!Object.hasOwn(WRONG_OPERATORS, name)) {
        const suggestion = suggest(name, LONG_OPERATORS, name.length >= 6 ? 2 : 1);
        if (suggestion) report.warn(`Unknown operator '${t.text}'. Did you mean '-${suggestion}'?`, t);
      }
    }
  }
}
