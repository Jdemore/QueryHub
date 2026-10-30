// Loading, validating, and serializing the query "database" (data/queries.json).
// Every record is normalized here so the rest of the app can trust its shape.

import { DATA_URL, STATUS_KEYS } from './config.js';

const MAX_TITLE = 200;
const MAX_TEXT = 20000;
const MAX_TAGS = 20;
const MAX_ROWS = 200;
const MAX_CELL = 2000;

export async function loadQueries() {
  const res = await fetch(DATA_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${DATA_URL} (HTTP ${res.status})`);
  return normalizeDatabase(await res.json());
}

// Accepts either { version, queries: [...] } or a bare array.
export function normalizeDatabase(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.queries) ? raw.queries : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const q = normalizeQuery(item);
    if (q && !seen.has(q.id)) {
      seen.add(q.id);
      out.push(q);
    }
  }
  return out;
}

// Returns a clean query object, or null if the record is unusable.
export function normalizeQuery(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.title, MAX_TITLE);
  const query = text(raw.query, MAX_TEXT);
  if (!title || !query) return null;
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : newId(),
    title,
    status: STATUS_KEYS.includes(raw.status) ? raw.status : 'mostly',
    tags: normalizeTags(raw.tags),
    description: text(raw.description, MAX_TEXT),
    query,
    sampleResults: normalizeSample(raw.sampleResults),
    updated: /^\d{4}-\d{2}-\d{2}$/.test(raw.updated || '') ? raw.updated : '',
  };
}

function normalizeTags(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(',') : []);
  const tags = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const tag = item.trim().toLowerCase().slice(0, 40);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function normalizeSample(raw) {
  if (!raw || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;
  const columns = raw.columns.map((c) => cell(c));
  if (columns.length === 0) return null;
  const rows = raw.rows
    .slice(0, MAX_ROWS)
    .filter(Array.isArray)
    .map((row) => columns.map((_, i) => cell(row[i])));
  return { columns, rows };
}

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, MAX_CELL);
  return String(value).slice(0, MAX_CELL);
}

function text(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

export function newId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function serializeDatabase(queries) {
  return JSON.stringify({ version: 1, queries }, null, 2) + '\n';
}

// Sample results are edited as tab-separated text: first line is the header.
// This matches what you get when copying a results grid from Log Analytics.
export function parseSampleText(value) {
  const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return null;
  const columns = lines[0].split('\t').map((c) => c.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return columns.map((_, i) => (cells[i] === undefined ? '' : cells[i].trim()));
  });
  return normalizeSample({ columns, rows });
}

export function sampleToText(sample) {
  if (!sample) return '';
  return [sample.columns, ...sample.rows].map((row) => row.join('\t')).join('\n');
}
