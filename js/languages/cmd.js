// Windows Command Prompt / batch (.cmd): tokenizer and heuristic syntax
// checker. Batch syntax is loose, so the checker sticks to the classic
// traps: unbalanced blocks, missing labels, IF/FOR/ELSE shape, SET spacing.

import {
  createScanner, createReport, significant, checkLexical, suggest, isSmartQuote,
} from './shared.js';

const KEYWORDS = new Set([
  'if', 'else', 'for', 'in', 'do', 'not', 'exist', 'defined', 'errorlevel',
  'cmdextversion', 'equ', 'neq', 'lss', 'leq', 'gtr', 'geq', 'goto', 'call', 'exit',
  'set', 'setlocal', 'endlocal', 'echo', 'rem', 'pause', 'shift', 'nul', 'con',
]);

// Built-in and common external commands, highlighted as commands.
const COMMANDS = new Set([
  'assoc', 'attrib', 'bitsadmin', 'cd', 'certutil', 'chcp', 'chdir', 'chkdsk', 'choice',
  'clip', 'cls', 'cmd', 'color', 'comp', 'copy', 'cscript', 'curl', 'date', 'del', 'dir',
  'diskpart', 'dism', 'doskey', 'erase', 'explorer', 'fc', 'find', 'findstr', 'format',
  'ftype', 'gpresult', 'gpupdate', 'hostname', 'icacls', 'ipconfig', 'label', 'md',
  'mkdir', 'mklink', 'mode', 'more', 'move', 'msiexec', 'net', 'netsh', 'netstat',
  'notepad', 'nslookup', 'path', 'ping', 'popd', 'powershell', 'prompt', 'pushd', 'pwsh',
  'rd', 'reg', 'regedit', 'ren', 'rename', 'rmdir', 'robocopy', 'runas', 'rundll32', 'sc',
  'schtasks', 'setx', 'sfc', 'shutdown', 'sort', 'start', 'subst', 'systeminfo',
  'takeown', 'tar', 'taskkill', 'tasklist', 'time', 'timeout', 'title', 'tracert', 'tree',
  'type', 'ver', 'vol', 'where', 'whoami', 'winget', 'wmic', 'wscript', 'xcopy',
  'calc', 'code', 'git', 'node', 'npm', 'python', 'pip', 'ssh', 'scp', 'wsl', 'az',
  'dotnet', 'docker', 'kubectl', 'java', 'nuget', 'choco',
]);

const COMPARE_KEYWORDS = new Set(['equ', 'neq', 'lss', 'leq', 'gtr', 'geq']);
const TEST_KEYWORDS = new Set(['exist', 'defined', 'errorlevel', 'cmdextversion']);
// Commands whose arguments are literal text: parentheses there are not blocks.
const TEXT_COMMANDS = new Set(['echo', 'title', 'set', 'rem']);
// Only these are offered as "did you mean" targets, to avoid flagging programs.
const TYPO_TARGETS = [
  'echo', 'goto', 'call', 'exit', 'pause', 'setlocal', 'endlocal', 'mkdir', 'rmdir',
  'rename', 'title', 'timeout', 'choice', 'xcopy', 'robocopy', 'findstr', 'taskkill',
  'tasklist', 'shift', 'start', 'pushd', 'popd', 'copy', 'move',
];

const MULTI_OPS = ['2>&1', '1>&2', '&&', '||', '==', '>>', '2>>', '2>', '1>'];
const ONE_CHAR_OPS = '&><=@*+-%!';
const WORD_START = /[A-Za-z_]/;
const WORD_CHAR = /[A-Za-z0-9_.-]/;
const VARIABLE_PATTERNS = [
  /^%%~[A-Za-z$]*[A-Za-z]/, // %%~nxI
  /^%%[A-Za-z]/, // %%i
  /^%~[A-Za-z$]*[0-9]/, // %~dp0
  /^%[0-9*]/, // %1 %*
  /^%[A-Za-z_][^%\s]*%/, // %NAME% and %NAME:~0,3%
  /^![A-Za-z_][^!\s]*!/, // !NAME! (delayed expansion)
];

export function tokenize(src) {
  const s = createScanner(src);
  const n = src.length;
  let lineStart = true; // no command word seen yet on this line

  while (s.pos < n) {
    const ws = s.whitespace();
    if (ws) {
      if (ws.text.includes('\n')) lineStart = true;
      continue;
    }
    const i = s.pos;
    const ch = src[i];
    const next = src[i + 1];
    const rest = src.slice(i, i + 80);

    if (lineStart) {
      if (ch === '@') { s.push('operator', i + 1); continue; }
      if (ch === ':' && next === ':') { s.push('comment', s.lineEnd()); lineStart = false; continue; }
      if (ch === ':') { s.push('function', s.run(/[^\s]/, i), { label: true }); lineStart = false; continue; }
      if (/^rem(\s|$)/i.test(rest)) { s.push('comment', s.lineEnd()); lineStart = false; continue; }
    }
    lineStart = false;

    // Caret escapes the next character; caret + newline continues the line.
    if (ch === '^') {
      if (next === '\n' || next === '\r' || next === undefined) s.push('ws', i + 1);
      else s.push('ident', i + 2);
      continue;
    }
    // A quote with no partner on the line is legal in batch, so never flagged.
    if (ch === '"') {
      const close = src.indexOf('"', i + 1);
      const eol = s.lineEnd();
      s.push('string', close !== -1 && close < eol ? close + 1 : eol);
      continue;
    }
    if (ch === '%' || ch === '!') {
      const pattern = VARIABLE_PATTERNS.find((p) => p.test(rest));
      if (pattern) { s.push('variable', i + pattern.exec(rest)[0].length); continue; }
    }
    if (/[0-9]/.test(ch) && !/^[12]>/.test(rest)) { s.push('number', s.run(/[0-9]/, i)); continue; }

    if (WORD_START.test(ch)) {
      const j = s.run(WORD_CHAR, i + 1);
      const lower = src.slice(i, j).toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
      s.push(KEYWORDS.has(lower) ? 'keyword' : (COMMANDS.has(lower) ? 'function' : 'ident'), j);
      continue;
    }
    // Switches such as /i, /f, /?
    if (ch === '/' && /[A-Za-z?]/.test(next || '') && (i === 0 || /\s/.test(src[i - 1]))) {
      s.push('type', s.run(/[A-Za-z0-9?:]/, i + 1));
      continue;
    }

    if (ch === '|' && next !== '|') { s.push('pipe', i + 1); continue; }
    const multi = MULTI_OPS.find((op) => src.startsWith(op, i));
    if (multi) { s.push('operator', i + multi.length); continue; }
    if (ONE_CHAR_OPS.includes(ch)) { s.push('operator', i + 1); continue; }
    s.push(isSmartQuote(ch) ? 'unknown' : 'punct', i + 1);
  }
  return s.tokens;
}

const isPunct = (t, text) => Boolean(t) && t.type === 'punct' && t.text === text;
const keyword = (t) => (t && t.type === 'keyword' ? t.text.toLowerCase() : '');

export function lint(src) {
  const report = createReport();
  if (!src || !src.trim()) {
    report.error('Script is empty.');
    return report.finish();
  }
  const all = tokenize(src);
  checkLexical(all, report);
  const lines = groupByLine(significant(all));

  const labels = new Set();
  for (const line of lines) {
    for (const t of line) if (t.label) labels.add(t.text.slice(1).toLowerCase());
  }

  const openBlocks = [];
  for (const line of lines) {
    const first = line.find((t) => !(t.type === 'operator' && t.text === '@'));
    if (!first) continue;
    const command = first.text.toLowerCase();

    checkBlocks(line, command, openBlocks, report);

    if (keyword(first) === 'else') {
      report.error("ELSE must be on the same line as the ')' that closes the IF block, for example ') else ('.", first);
    }
    if (first.type === 'ident' && first.text.length >= 4) {
      const suggestion = suggest(first.text, TYPO_TARGETS, 1);
      if (suggestion) report.warn(`Unknown command '${first.text}'. Did you mean '${suggestion}'?`, first);
    }

    line.forEach((t, i) => {
      const word = keyword(t);
      if (word === 'if') checkIf(line, i, report);
      else if (word === 'for') checkFor(line, i, report);
      else if (word === 'goto' || word === 'call') checkJump(line, i, word, labels, report);
    });
  }
  for (const open of openBlocks) report.error("Unclosed '(' block.", open);

  checkSetSpacing(src, report);
  return report.finish();
}

function groupByLine(tokens) {
  const lines = [];
  let current = null;
  let currentLine = -1;
  for (const t of tokens) {
    if (t.line !== currentLine) {
      current = [];
      lines.push(current);
      currentLine = t.line;
    }
    current.push(t);
  }
  return lines;
}

// Counts block parentheses. Text after echo/title/set at the top level is
// literal, so its parentheses are skipped; inside a block cmd itself treats
// an unescaped ')' as the end of the block, and so does this.
function checkBlocks(line, command, openBlocks, report) {
  if (TEXT_COMMANDS.has(command) && openBlocks.length === 0) return;
  for (const t of line) {
    if (isPunct(t, '(')) {
      openBlocks.push(t);
    } else if (isPunct(t, ')')) {
      if (openBlocks.length === 0) report.error("Unexpected ')' with no open block.", t);
      else openBlocks.pop();
    }
  }
}

// if [/i] [not] exist|defined|errorlevel ...   or   if [/i] [not] A == B
function checkIf(line, i, report) {
  let j = i + 1;
  while (line[j] && (line[j].type === 'type' || keyword(line[j]) === 'not')) j += 1;
  if (!line[j]) {
    report.error('IF has no condition.', line[i]);
    return;
  }
  if (TEST_KEYWORDS.has(keyword(line[j]))) return;
  for (let k = j; k < line.length; k += 1) {
    const t = line[k];
    if (t.type === 'operator' && t.text === '==') return;
    if (COMPARE_KEYWORDS.has(keyword(t))) return;
    if (t.type === 'operator' && t.text === '=') {
      report.error("IF comparisons use '==', not '='.", t);
      return;
    }
    if (isPunct(t, '(')) break;
  }
  report.warn("IF has no comparison. Expected '==', EQU, NEQ, LSS, LEQ, GTR, GEQ, or EXIST / DEFINED / ERRORLEVEL.", line[i]);
}

// for [/f "options"] %%i in (set) do command
function checkFor(line, i, report) {
  const rest = line.slice(i + 1);
  const inIndex = rest.findIndex((t) => keyword(t) === 'in');
  const head = inIndex === -1 ? rest : rest.slice(0, inIndex);
  const singlePercent = head.find((t) => t.type === 'operator' && t.text === '%');
  if (singlePercent) {
    report.warn('In a .cmd file the loop variable needs two percent signs (%%i). A single % only works when typed at the prompt.', singlePercent);
  } else if (!head.some((t) => t.type === 'variable')) {
    report.error('FOR needs a loop variable such as %%i.', line[i]);
  }
  if (inIndex === -1) report.error("FOR is missing 'in (...)'.", line[i]);
  if (!rest.some((t) => keyword(t) === 'do')) report.error("FOR is missing 'do'.", line[i]);
}

// goto label / call :label must point at a label that exists.
function checkJump(line, i, word, labels, report) {
  let target = line[i + 1];
  const hasColon = isPunct(target, ':');
  if (hasColon) target = line[i + 2];
  if (word === 'call' && !hasColon) return; // call of a program or another script
  if (!target || target.type === 'variable' || !['ident', 'keyword', 'function', 'number'].includes(target.type)) return;
  const name = target.text.toLowerCase();
  if (name === 'eof' && hasColon) return;
  if (!labels.has(name)) report.error(`Label ':${target.text}' not found.`, target);
}

// "set NAME = value" creates a variable called "NAME " (with the space).
function checkSetSpacing(src, report) {
  src.split('\n').forEach((text, index) => {
    const match = /^(\s*@?\s*set\s+)(?!\/)"?[A-Za-z_][A-Za-z0-9_]*\s+=/i.exec(text);
    if (match) {
      report.warn("Space before '=' becomes part of the variable name. Write: set NAME=value", { line: index + 1, col: match[1].length + 1 });
    }
  });
}
