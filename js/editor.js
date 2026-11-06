// Add/Edit dialog. Collects a raw record and hands it to onSave; main.js
// normalizes it. The code field is linted live for the selected language.

import { $, el, clear } from './dom.js';
import { LANGUAGES, LANGUAGE_KEYS, DEFAULT_LANGUAGE, lint } from './languages/index.js';
import { renderLintMessages } from './render.js';
import { parseSampleText, sampleToText } from './data.js';
import { STATUS_KEYS } from './config.js';

export function createEditor(dialog, settings, onSave) {
  const form = $('#editor-form', dialog);
  const heading = $('#editor-title', dialog);
  const lintOut = $('#editor-lint', dialog);
  const platformField = $('#platform-field', dialog);
  const queryLabel = $('#f-query-label', dialog);
  const f = {
    id: $('#f-id', dialog),
    title: $('#f-title', dialog),
    language: $('#f-language', dialog),
    platform: $('#f-platform', dialog),
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
  clear(f.language);
  for (const key of LANGUAGE_KEYS) {
    f.language.append(el('option', { value: key, text: `${LANGUAGES[key].label} (${LANGUAGES[key].extension})` }));
  }

  // Rebuilds the platform list for the chosen language and hides the field
  // when that language has no platforms.
  function showPlatforms(selected) {
    const language = LANGUAGES[f.language.value];
    clear(f.platform);
    f.platform.append(el('option', { value: '', text: 'Not specified' }));
    for (const [key, label] of Object.entries(language.platforms)) {
      f.platform.append(el('option', { value: key, text: label }));
    }
    f.platform.value = Object.hasOwn(language.platforms, selected) ? selected : '';
    platformField.hidden = Object.keys(language.platforms).length === 0;
    queryLabel.textContent = `Code (${language.label})`;
  }

  let timer = null;
  const runLint = () => {
    if (f.query.value.trim()) renderLintMessages(lintOut, lint(f.query.value, f.language.value, f.platform.value));
    else clear(lintOut);
  };
  f.query.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(runLint, 300);
  });
  f.language.addEventListener('change', () => {
    showPlatforms('');
    runLint();
  });
  f.platform.addEventListener('change', runLint);

  $('#editor-cancel', dialog).addEventListener('click', () => dialog.close());

  // Native "required" validation runs before this fires.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onSave({
      id: f.id.value,
      title: f.title.value,
      language: f.language.value,
      platform: f.platform.value,
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
      heading.textContent = query ? 'Edit entry' : 'Add entry';
      f.id.value = query ? query.id : '';
      f.title.value = query ? query.title : '';
      f.language.value = query ? query.language : DEFAULT_LANGUAGE;
      showPlatforms(query ? query.platform : '');
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
