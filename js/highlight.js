// Syntax highlighting: turns source text into a DocumentFragment of spans.
// Only class names are generated from token types; the text itself is
// always inserted as a text node, so content can never become markup.

import { tokenize } from './languages/index.js';

const PLAIN = new Set(['ws', 'punct', 'ident', 'unknown']);

export function highlight(src, languageKey) {
  const frag = document.createDocumentFragment();
  for (const tok of tokenize(src, languageKey)) {
    if (PLAIN.has(tok.type)) {
      frag.append(document.createTextNode(tok.text));
    } else {
      const span = document.createElement('span');
      span.className = 'tok-' + tok.type;
      span.textContent = tok.text;
      frag.append(span);
    }
  }
  return frag;
}
