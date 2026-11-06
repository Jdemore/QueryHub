// Language registry. To add a language: create a module that exports
// tokenize(src) and lint(src, options), then add an entry here and to the
// "language" check constraint in setup/schema.sql.

import * as kql from './kql.js';
import * as sql from './sql.js';
import * as powershell from './powershell.js';
import * as cmd from './cmd.js';

export const LANGUAGES = {
  kql: {
    label: 'KQL',
    extension: '.kql',
    platforms: { sentinel: 'Sentinel Logs', defender: 'Defender Threat Hunting' },
    ...kql,
  },
  sql: { label: 'SQL', extension: '.sql', platforms: {}, ...sql },
  powershell: { label: 'PowerShell', extension: '.ps1', platforms: {}, ...powershell },
  cmd: { label: 'Command Prompt', extension: '.cmd', platforms: {}, ...cmd },
};

export const LANGUAGE_KEYS = Object.keys(LANGUAGES);
export const DEFAULT_LANGUAGE = 'kql';

export function isLanguage(key) {
  return typeof key === 'string' && Object.hasOwn(LANGUAGES, key);
}

export function getLanguage(key) {
  return LANGUAGES[isLanguage(key) ? key : DEFAULT_LANGUAGE];
}

export function isPlatform(languageKey, platform) {
  return typeof platform === 'string' && Object.hasOwn(getLanguage(languageKey).platforms, platform);
}

// Display name of a platform, or '' when the entry has none.
export function platformLabel(languageKey, platform) {
  return isPlatform(languageKey, platform) ? getLanguage(languageKey).platforms[platform] : '';
}

export function tokenize(src, languageKey) {
  return getLanguage(languageKey).tokenize(src);
}

// Returns [{ severity: 'error' | 'warning', message, line, col }].
export function lint(src, languageKey, platform = '') {
  return getLanguage(languageKey).lint(src, { platform });
}
