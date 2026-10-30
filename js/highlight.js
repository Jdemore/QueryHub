// Syntax highlighting: turns KQL text into a DocumentFragment of spans.
// Only class names are generated from token types; the text itself is
// always inserted as a text node, so query content can never become markup.

import { tokenize } from './tokenizer.js';

const PLAIN = new Set(['ws', 'punct', 'ident', 'unknown']);

export function highlightKql(src) {
  const frag = document.createDocumentFragment();
  for (const tok of tokenize(src)) {
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
