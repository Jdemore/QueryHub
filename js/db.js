// Reads and writes through Supabase's REST API (PostgREST). Reads use the
// public anon key; writes send the signed-in user's access token and the
// database's row-level security decides what is allowed.
//
// Writes ask for the affected rows back and treat "zero rows" as "not
// allowed", because PostgREST answers 2xx even when RLS filtered everything.

import { normalizeDatabase, normalizeProfile } from './data.js';

const QUERY_SELECT = [
  'id,title,language,platform,status,tags,description,query,sample_results,updated_at,owner_id',
  // "!column" hints pick the direct foreign key; without them PostgREST also
  // sees the many-to-many path through query_votes and refuses to choose.
  'owner:profiles!owner_id(username)',
  'votes:query_votes(user_id,vote)',
  'comments:query_comments(id,user_id,body,created_at,author:profiles!user_id(username))',
].join(',');

export function createDb(cfg) {
  const rest = (path) => `${cfg.url}/rest/v1/${path}`;

  const headers = (token, extra = {}) => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token || cfg.anonKey}`,
    ...extra,
  });

  const jsonHeaders = (token, prefer) => headers(token, { 'Content-Type': 'application/json', Prefer: prefer });

  async function request(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw await describe(res);
    return res;
  }

  // Runs a write that returns the affected rows; throws if none were.
  async function affecting(url, options) {
    const res = await request(url, options);
    const rows = await res.json().catch(() => []);
    if (!Array.isArray(rows) || rows.length === 0) {
      const err = new Error('Not allowed. You can only change your own posts.');
      err.status = 403;
      throw err;
    }
    return rows;
  }

  return {
    async list(token) {
      const url = rest(`queries?select=${QUERY_SELECT}&order=updated_at.desc&comments.order=created_at.asc`);
      const res = await request(url, { headers: headers(token), cache: 'no-store' });
      const rows = await res.json();
      return normalizeDatabase(Array.isArray(rows) ? rows.map(fromRow) : []);
    },

    async profile(token, userId) {
      const url = rest(`profiles?select=id,username,is_admin&id=eq.${encodeURIComponent(userId)}`);
      const res = await request(url, { headers: headers(token), cache: 'no-store' });
      const rows = await res.json();
      return Array.isArray(rows) && rows[0] ? normalizeProfile(rows[0]) : null;
    },

    async usernameTaken(username) {
      const url = rest(`profiles?select=id&username=eq.${encodeURIComponent(username)}`);
      const res = await request(url, { headers: headers(null), cache: 'no-store' });
      const rows = await res.json();
      return Array.isArray(rows) && rows.length > 0;
    },

    async insertQuery(token, q, ownerId) {
      await request(rest('queries'), {
        method: 'POST',
        headers: jsonHeaders(token, 'return=minimal'),
        body: JSON.stringify([{ ...toRow(q), owner_id: ownerId }]),
      });
    },

    async updateQuery(token, q) {
      await affecting(rest(`queries?id=eq.${encodeURIComponent(q.id)}`), {
        method: 'PATCH',
        headers: jsonHeaders(token, 'return=representation'),
        body: JSON.stringify(toRow(q)),
      });
    },

    async deleteQuery(token, id) {
      await affecting(rest(`queries?id=eq.${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: headers(token, { Prefer: 'return=representation' }),
      });
    },

    // vote is 'works', 'broken', or null to remove.
    async setVote(token, queryId, userId, vote) {
      const where = `query_id=eq.${encodeURIComponent(queryId)}&user_id=eq.${encodeURIComponent(userId)}`;
      if (vote === null) {
        await affecting(rest(`query_votes?${where}`), {
          method: 'DELETE',
          headers: headers(token, { Prefer: 'return=representation' }),
        });
        return;
      }
      await request(rest('query_votes'), {
        method: 'POST',
        headers: jsonHeaders(token, 'resolution=merge-duplicates,return=minimal'),
        body: JSON.stringify([{ query_id: queryId, user_id: userId, vote }]),
      });
    },

    async addComment(token, queryId, userId, body) {
      await request(rest('query_comments'), {
        method: 'POST',
        headers: jsonHeaders(token, 'return=minimal'),
        body: JSON.stringify([{ query_id: queryId, user_id: userId, body }]),
      });
    },

    async deleteComment(token, id) {
      await affecting(rest(`query_comments?id=eq.${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: headers(token, { Prefer: 'return=representation' }),
      });
    },
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    language: row.language,
    platform: row.platform,
    status: row.status,
    tags: row.tags,
    description: row.description,
    query: row.query,
    sampleResults: row.sample_results,
    updated: typeof row.updated_at === 'string' ? row.updated_at.slice(0, 10) : '',
    ownerId: row.owner_id,
    ownerName: row.owner && row.owner.username,
    votes: Array.isArray(row.votes) ? row.votes.map((v) => ({ userId: v.user_id, vote: v.vote })) : [],
    comments: Array.isArray(row.comments) ? row.comments.map((c) => ({
      id: c.id,
      userId: c.user_id,
      author: c.author && c.author.username,
      body: c.body,
      createdAt: c.created_at,
    })) : [],
  };
}

function toRow(q) {
  return {
    id: q.id,
    title: q.title,
    language: q.language,
    platform: q.platform || null,
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
  if (/column .* does not exist|could not find the .* column/i.test(detail)) {
    const err = new Error('The database is missing newer columns. Run setup/schema.sql in the Supabase SQL editor, then reload.');
    err.status = res.status;
    return err;
  }
  const text = {
    401: 'Not signed in, or the session expired. Sign in again.',
    403: 'Not allowed. You can only change your own posts.',
    404: 'A table is missing. Run setup/schema.sql in the Supabase SQL editor.',
  }[res.status] || 'Database error.';
  const err = new Error(`${text} (HTTP ${res.status}${detail ? ': ' + detail : ''})`);
  err.status = res.status;
  return err;
}
