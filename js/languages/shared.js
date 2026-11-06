// Building blocks shared by every language module: a source scanner that
// records tokens with line/column, a message collector, and the checks that
// are the same in any language (brackets, unterminated tokens, typos).
//
// Token shape: { type, text, line, col, unterminated? }
// Token types: ws, comment, string, number, ident, keyword, type, function,
//              variable, pipe, operator, punct, unknown.

// Invisible characters that copy/paste from web pages tends to insert.
// Built from char codes so this file stays pure ASCII.
const INVISIBLE = String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff);
export const WHITESPACE = new RegExp('[\\s' + INVISIBLE + ']');

const SMART_QUOTES = String.fromCharCode(0x2018, 0x2019, 0x201c, 0x201d);
export const isSmartQuote = (ch) => SMART_QUOTES.includes(ch);

export const BRACKETS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set(Object.values(BRACKETS));

// Cursor over the source. push() emits src[pos..end) as one token.
export function createScanner(src) {
  const tokens = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function push(type, end, extra) {
    const text = src.slice(pos, end);
    const tok = { type, text, line, col };
    if (extra) Object.assign(tok, extra);
    tokens.push(tok);
    for (const ch of text) {
      if (ch === '\n') { line += 1; col = 1; } else { col += 1; }
    }
    pos = end;
    return tok;
  }

  // Index just past the run of characters matching regex, starting at from.
  function run(regex, from = pos) {
    let j = from;
    while (j < src.length && regex.test(src[j])) j += 1;
    return j;
  }

  return {
    tokens,
    push,
    run,
    get pos() { return pos; },
    lineEnd(from = pos) {
      const j = src.indexOf('\n', from);
      return j === -1 ? src.length : j;
    },
    // Consumes a run of whitespace. Returns the token, or null if none.
    whitespace() {
      if (pos >= src.length || !WHITESPACE.test(src[pos])) return null;
      return push('ws', run(WHITESPACE, pos + 1));
    },
    // Quoted string starting at pos. escape is a backslash-style escape
    // character or ''; doubled quotes always count as an escaped quote when
    // doubling is true. Stops at a newline unless multiline is true.
    string(start, quote, { escape = '', doubling = false, multiline = false, type = 'string' } = {}) {
      let j = start + 1;
      let closed = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '\n' && !multiline) break;
        if (escape && c === escape) { j += 2; continue; }
        if (c === quote) {
          if (doubling && src[j + 1] === quote) { j += 2; continue; }
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      return push(type, Math.min(j, src.length), closed ? null : { unterminated: true });
    },
  };
}

// Drops whitespace and comments.
export function significant(tokens) {
  return tokens.filter((t) => t.type !== 'ws' && t.type !== 'comment');
}

// Collects lint messages. finish() removes duplicates and sorts by position.
export function createReport() {
  const messages = [];
  const add = (severity, message, at) => {
    messages.push({ severity, message, line: at ? at.line : 1, col: at ? at.col : 1 });
  };
  return {
    add,
    error: (message, at) => add('error', message, at),
    warn: (message, at) => add('warning', message, at),
    finish() {
      const seen = new Set();
      return messages
        .filter((m) => {
          const key = `${m.line}:${m.col}:${m.message}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.line - b.line || a.col - b.col);
    },
  };
}

// Unterminated strings/comments, curly quotes, and stray characters.
export function checkLexical(tokens, report, { smartQuoteSeverity = 'error' } = {}) {
  for (const t of tokens) {
    if (t.unterminated) {
      report.error(t.type === 'comment' ? 'Unterminated block comment.' : 'Unterminated string literal.', t);
    }
    if (t.type !== 'unknown') continue;
    if (isSmartQuote(t.text)) {
      report.add(smartQuoteSeverity, 'Curly "smart" quote, usually from pasting out of a document or chat. Replace it with a straight quote.', t);
    } else {
      report.error(`Unexpected character '${t.text}'.`, t);
    }
  }
}

export function checkBrackets(tokens, report, pairs = BRACKETS) {
  const closers = {};
  for (const [open, close] of Object.entries(pairs)) closers[close] = open;
  const stack = [];
  for (const t of tokens) {
    if (t.type !== 'punct') continue;
    if (Object.hasOwn(pairs, t.text)) {
      stack.push(t);
    } else if (Object.hasOwn(closers, t.text)) {
      const open = stack.pop();
      if (!open) report.error(`Unexpected '${t.text}' with no matching '${closers[t.text]}'.`, t);
      else if (pairs[open.text] !== t.text) {
        report.error(`Mismatched brackets: '${open.text}' at line ${open.line} is closed by '${t.text}'.`, t);
      }
    }
  }
  for (const open of stack) report.error(`Unclosed '${open.text}'.`, open);
}

// Bracket depth after token t, for splitting on separators at depth 0.
export function trackDepth(t, depth) {
  if (t.type !== 'punct') return depth;
  if (Object.hasOwn(BRACKETS, t.text)) return depth + 1;
  if (CLOSERS.has(t.text)) return Math.max(0, depth - 1);
  return depth;
}

// Closest candidate within maxDistance edits, or null. Case-insensitive.
export function suggest(word, candidates, maxDistance) {
  const lower = word.toLowerCase();
  const limit = maxDistance !== undefined ? maxDistance : (lower.length <= 4 ? 1 : 2);
  let best = null;
  let bestDist = limit + 1;
  for (const candidate of candidates) {
    const d = editDistance(lower, candidate.toLowerCase());
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
    }
  }
  return best;
}

// Edit distance where swapping two adjacent letters counts as one edit.
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = [];
  for (let i = 0; i <= a.length; i += 1) d.push([i]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}
