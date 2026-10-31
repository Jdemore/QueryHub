// Supabase Auth with plain fetch. Accounts are username + PIN; the username
// is mapped to a synthetic email address because Supabase requires one.
// The session lives in localStorage and refreshes itself before expiry.

import * as storage from './storage.js';

const USERNAME_DOMAIN = 'queryhub.local';
const REFRESH_MARGIN_SECONDS = 60;

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
export const PIN_PATTERN = /^[0-9]{6}$/;

// Users created from the Supabase dashboard sign in with their real email.
function toEmail(identifier) {
  const value = identifier.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@${USERNAME_DOMAIN}`;
}

function friendly(status, detail) {
  const d = detail.toLowerCase();
  if (d.includes('invalid login credentials')) return 'Wrong username or PIN.';
  if (d.includes('database error saving new user')) return 'Sign-up was rejected. Check the invite code.';
  if (d.includes('already registered') || d.includes('already been registered')) return 'That username is already taken.';
  if (d.includes('signups not allowed') || d.includes('signup is disabled')) return 'Sign-ups are turned off in Supabase (Authentication > Sign In / Providers).';
  if (d.includes('email not confirmed')) return 'Turn off "Confirm email" in Supabase (Authentication > Sign In / Providers).';
  if (d.includes('password should be')) return 'PIN must be 6 digits.';
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  return detail ? `${detail} (HTTP ${status})` : `Request failed (HTTP ${status})`;
}

export function createAuth(cfg) {
  let session = storage.getSession();
  const baseHeaders = { apikey: cfg.anonKey, 'Content-Type': 'application/json' };

  async function post(path, body, token) {
    const headers = token ? { ...baseHeaders, Authorization: `Bearer ${token}` } : baseHeaders;
    const res = await fetch(`${cfg.url}/auth/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      throw new Error(friendly(res.status, data.error_description || data.msg || data.message || data.error || ''));
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
        userId: (data.user && data.user.id) || '',
      };
    }
    storage.setSession(session);
  }

  return {
    isSignedIn: () => Boolean(session),
    userId: () => (session ? session.userId : ''),

    async signIn(identifier, pin) {
      setSession(await post('token?grant_type=password', { email: toEmail(identifier), password: pin }));
    },

    // The invite code and username travel as user metadata; a database
    // trigger validates them and creates the profile, or rejects the sign-up.
    async signUp(username, pin, inviteCode) {
      const name = username.trim().toLowerCase();
      if (!USERNAME_PATTERN.test(name)) throw new Error('Username must be 3-20 characters: letters, numbers, underscore.');
      if (!PIN_PATTERN.test(pin)) throw new Error('PIN must be exactly 6 digits.');
      if (!inviteCode.trim()) throw new Error('Invite code is required.');
      const data = await post('signup', {
        email: toEmail(name),
        password: pin,
        data: { username: name, invite_code: inviteCode.trim() },
      });
      if (!data.access_token) {
        throw new Error('Account created but not signed in. Turn off "Confirm email" in Supabase, then sign in.');
      }
      setSession(data);
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
