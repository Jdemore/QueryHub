// Validation of records coming from the database or the editor. Everything
// is normalized here so the rest of the app can trust its shape.

import { STATUS_KEYS } from './config.js';
import { DEFAULT_LANGUAGE, isLanguage, isPlatform } from './languages/index.js';

const MAX_TITLE = 200;
const MAX_TEXT = 20000;
const MAX_TAGS = 20;
const MAX_ROWS = 200;
const MAX_CELL = 2000;
const MAX_COMMENT = 4000;
const ID_PATTERN = /^[\w-]{1,64}$/;
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const VOTE_KEYS = ['works', 'broken'];

// Accepts either { queries: [...] } or a bare array of raw records.
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
  const language = isLanguage(raw.language) ? raw.language : DEFAULT_LANGUAGE;
  return {
    id: id(raw.id) || newId(),
    title,
    language,
    platform: isPlatform(language, raw.platform) ? raw.platform : '',
    status: STATUS_KEYS.includes(raw.status) ? raw.status : 'mostly',
    tags: normalizeTags(raw.tags),
    description: text(raw.description, MAX_TEXT),
    query,
    sampleResults: normalizeSample(raw.sampleResults),
    updated: /^\d{4}-\d{2}-\d{2}$/.test(raw.updated || '') ? raw.updated : '',
    ownerId: id(raw.ownerId),
    ownerName: username(raw.ownerName),
    votes: normalizeVotes(raw.votes),
    comments: normalizeComments(raw.comments),
  };
}

export function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const userId = id(raw.id);
  const name = username(raw.username);
  if (!userId || !name) return null;
  return { id: userId, username: name, isAdmin: raw.is_admin === true };
}

function normalizeVotes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const userId = id(v.userId);
    if (!userId || seen.has(userId) || !VOTE_KEYS.includes(v.vote)) continue;
    seen.add(userId);
    out.push({ userId, vote: v.vote });
  }
  return out;
}

function normalizeComments(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const commentId = id(c.id);
    const body = text(c.body, MAX_COMMENT);
    if (!commentId || !body) continue;
    out.push({
      id: commentId,
      userId: id(c.userId),
      author: username(c.author) || 'deleted user',
      body,
      createdAt: typeof c.createdAt === 'string' && !Number.isNaN(Date.parse(c.createdAt)) ? c.createdAt : '',
    });
  }
  return out;
}

function id(value) {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : '';
}

function username(value) {
  return typeof value === 'string' && USERNAME_PATTERN.test(value) ? value : '';
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

// Tally of community votes plus the current user's own vote.
export function voteSummary(q, userId) {
  let works = 0;
  let broken = 0;
  let mine = null;
  for (const v of q.votes) {
    if (v.vote === 'works') works += 1; else broken += 1;
    if (userId && v.userId === userId) mine = v.vote;
  }
  return { works, broken, mine };
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
