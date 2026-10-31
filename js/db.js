// Reads and writes the "queries" table through Supabase's REST API
// (PostgREST). Reads use the public anon key; writes send the signed-in
// user's access token, and the database's row-level security decides.

import { normalizeDatabase } from './data.js';

const COLUMNS = 'id,title,status,tags,description,query,sample_results,updated_at';

export function createDb(cfg) {
  const table = `${cfg.url}/rest/v1/queries`;

  const headers = (token, extra = {}) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token || cfg.anonKey}`,
    ...extra,
  });

  async function request(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw await describe(res);
    return res;
  }

  return {
    async list(token) {
      const res = await request(`${table}?select=${COLUMNS}&order=updated_at.desc`, {
        headers: headers(token),
        cache: 'no-store',
      });
      const rows = await res.json();
      return normalizeDatabase(Array.isArray(rows) ? rows.map(fromRow) : []);
    },

    async upsert(token, q) {
      await request(table, {
        method: 'POST',
        headers: headers(token, {
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        }),
        body: JSON.stringify([toRow(q)]),
      });
    },

    async remove(token, id) {
      await request(`${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: headers(token, { Prefer: 'return=minimal' }),
      });
    },
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    tags: row.tags,
    description: row.description,
    query: row.query,
    sampleResults: row.sample_results,
    updated: typeof row.updated_at === 'string' ? row.updated_at.slice(0, 10) : '',
  };
}

function toRow(q) {
  return {
    id: q.id,
    title: q.title,
    status: q.status,
    tags: q.tags,
    description: q.description,
    query: q.query,
    sample_results: q.sampleResults,
    updated_at: new Date().toISOString(),
  };
}

async function describe(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || body.hint || body.error || '';
  } catch { /* no body */ }
  const text = {
    401: 'Not signed in, or the session expired. Sign in again.',
    403: 'Not allowed. Sign in with an account listed as an editor in setup/schema.sql.',
    404: 'The "queries" table was not found. Run setup/schema.sql in the Supabase SQL editor.',
  }[res.status] || 'Database error.';
  const err = new Error(`${text} (HTTP ${res.status}${detail ? ': ' + detail : ''})`);
  err.status = res.status;
  return err;
}
