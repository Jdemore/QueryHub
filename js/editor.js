// Add/Edit dialog. Collects a raw record and hands it to onSave; main.js
// normalizes it. The query field is linted live while typing.

import { $, el, clear } from './dom.js';
import { lintKql } from './lint.js';
import { renderLintMessages } from './render.js';
import { parseSampleText, sampleToText } from './data.js';
import { STATUS_KEYS } from './config.js';

export function createEditor(dialog, settings, onSave) {
  const form = $('#editor-form', dialog);
  const heading = $('#editor-title', dialog);
  const lintOut = $('#editor-lint', dialog);
  const f = {
    id: $('#f-id', dialog),
    title: $('#f-title', dialog),
    status: $('#f-status', dialog),
    tags: $('#f-tags', dialog),
    description: $('#f-description', dialog),
    query: $('#f-query', dialog),
    sample: $('#f-sample', dialog),
  };

  clear(f.status);
  for (const key of STATUS_KEYS) {
    f.status.append(el('option', { value: key, text: settings.statuses[key].label }));
  }

  let timer = null;
  const runLint = () => {
    if (f.query.value.trim()) renderLintMessages(lintOut, lintKql(f.query.value));
    else clear(lintOut);
  };
  f.query.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runLint, 300);
  });

  $('#editor-cancel', dialog).addEventListener('click', () => dialog.close());

  // Native "required" validation runs before this fires.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSave({
      id: f.id.value,
      title: f.title.value,
      status: f.status.value,
      tags: f.tags.value,
      description: f.description.value,
      query: f.query.value,
      sampleResults: parseSampleText(f.sample.value),
    });
    dialog.close();
  });

  return {
    open(query) {
      heading.textContent = query ? 'Edit query' : 'Add query';
      f.id.value = query ? query.id : '';
      f.title.value = query ? query.title : '';
      f.status.value = query ? query.status : 'works';
      f.tags.value = query ? query.tags.join(', ') : '';
      f.description.value = query ? query.description : '';
      f.query.value = query ? query.query : '';
      f.sample.value = query ? sampleToText(query.sampleResults) : '';
      runLint();
      dialog.showModal();
      f.title.focus();
    },
  };
}
