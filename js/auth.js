// Supabase Auth (email + password) with plain fetch. Keeps the session in
// localStorage and refreshes the access token before it expires.

import * as storage from './storage.js';

const REFRESH_MARGIN_SECONDS = 60;

export function createAuth(cfg) {
  let session = storage.getSession();
  const baseHeaders = { apikey: cfg.anonKey, 'Content-Type': 'application/json' };

  async function post(path, body, token) {
    const headers = token ? { ...baseHeaders, Authorization: `Bearer ${token}` } : baseHeaders;
    const res = await fetch(`${cfg.url}/auth/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const detail = data.error_description || data.msg || data.message || data.error || '';
      throw new Error(detail ? `${detail} (HTTP ${res.status})` : `Sign-in failed (HTTP ${res.status})`);
    }
    return data;
  }

  function setSession(data) {
    if (!data) {
      session = null;
    } else {
      session = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        email: (data.user && data.user.email) || '',
      };
    }
    storage.setSession(session);
  }

  return {
    isSignedIn: () => Boolean(session),
    email: () => (session ? session.email : ''),

    async signIn(email, password) {
      setSession(await post('token?grant_type=password', { email, password }));
    },

    async signOut() {
      if (session) {
        try {
          await fetch(`${cfg.url}/auth/v1/logout`, {
            method: 'POST',
            headers: { ...baseHeaders, Authorization: `Bearer ${session.accessToken}` },
          });
        } catch { /* best effort */ }
      }
      setSession(null);
    },

    // Returns a valid access token, refreshing if needed, or null when signed out.
    async getAccessToken() {
      if (!session) return null;
      if (session.expiresAt - Date.now() / 1000 > REFRESH_MARGIN_SECONDS) return session.accessToken;
      try {
        setSession(await post('token?grant_type=refresh_token', { refresh_token: session.refreshToken }));
        return session.accessToken;
      } catch {
        setSession(null);
        return null;
      }
    },
  };
}
