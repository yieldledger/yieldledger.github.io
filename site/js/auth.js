// Sign-in and portfolio storage.
// Cloud mode (Supabase) when config.js has keys: real accounts that sync across devices.
// Device mode otherwise: accounts and portfolios stored in this browser, passwords hashed with PBKDF2.

const cfg = window.YL_CONFIG || {};
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export async function createAuth() {
  if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
    try { return await cloudAuth(); } catch (e) { console.error('Cloud sign-in unavailable, using device accounts', e); }
  }
  return deviceAuth();
}

/* ---------------- device accounts ---------------- */
const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
async function hash(pw, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150000 }, key, 256));
}
function deviceAuth() {
  let user = LS.get('yl.session', null);
  const listeners = new Set();
  const emit = () => listeners.forEach(f => f(user));
  const norm = e => String(e || '').trim().toLowerCase();
  return {
    mode: 'device',
    current: () => user,
    onChange: f => (listeners.add(f), () => listeners.delete(f)),
    async signUp(email, pw) {
      email = norm(email);
      const users = LS.get('yl.users', {});
      if (users[email]) throw new Error('An account with this email already exists on this device. Sign in instead.');
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      users[email] = { salt, hash: await hash(pw, salt), created: new Date().toISOString() };
      if (!LS.set('yl.users', users)) throw new Error('This browser is blocking storage, so an account cannot be saved here.');
      user = { id: email, email }; LS.set('yl.session', user); emit(); return user;
    },
    async signIn(email, pw) {
      email = norm(email);
      const u = LS.get('yl.users', {})[email];
      if (!u || (await hash(pw, u.salt)) !== u.hash) throw new Error('Email or password is incorrect.');
      user = { id: email, email }; LS.set('yl.session', user); emit(); return user;
    },
    async signOut() { user = null; LS.del('yl.session'); emit(); },
    async load() { return user ? LS.get('yl.pf.' + user.id, null) : null; },
    async save(data) { if (user && !LS.set('yl.pf.' + user.id, data)) throw new Error('Could not save in this browser.'); },
    async deleteAccount() {
      if (!user) return;
      const users = LS.get('yl.users', {}); delete users[user.id]; LS.set('yl.users', users);
      LS.del('yl.pf.' + user.id); await this.signOut();
    },
  };
}

/* ---------------- cloud accounts (Supabase) ---------------- */
async function cloudAuth() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session } } = await sb.auth.getSession();
  let user = session ? { id: session.user.id, email: session.user.email } : null;
  const listeners = new Set();
  sb.auth.onAuthStateChange((_e, s) => {
    const next = s ? { id: s.user.id, email: s.user.email } : null;
    if ((next && next.id) !== (user && user.id)) { user = next; listeners.forEach(f => f(user)); }
  });
  const fail = e => { throw new Error(e.message || 'Sign-in failed.'); };
  return {
    mode: 'cloud',
    current: () => user,
    onChange: f => (listeners.add(f), () => listeners.delete(f)),
    async signUp(email, pw) {
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) fail(error);
      if (!data.session) return { pendingConfirm: true };
      user = { id: data.user.id, email: data.user.email }; return user;
    },
    async signIn(email, pw) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) fail(error);
      user = { id: data.user.id, email: data.user.email }; return user;
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) fail(error);
    },
    async signOut() { await sb.auth.signOut(); user = null; listeners.forEach(f => f(user)); },
    async load() {
      if (!user) return null;
      const { data, error } = await sb.from('portfolios').select('data').eq('user_id', user.id).maybeSingle();
      if (error) fail(error);
      return data ? data.data : null;
    },
    async save(d) {
      if (!user) return;
      const { error } = await sb.from('portfolios').upsert({ user_id: user.id, data: d, updated_at: new Date().toISOString() });
      if (error) fail(error);
    },
    async deleteAccount() {
      if (!user) return;
      await sb.from('portfolios').delete().eq('user_id', user.id);
      await this.signOut();
    },
  };
}
