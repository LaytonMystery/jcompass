/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Auth Guard
 *  Loaded in <head> on every protected page. Kicks off a server-side
 *  session verification in parallel with page load. app.js awaits
 *  window.JCOMPASS_AUTH_READY before booting.
 * ══════════════════════════════════════════════════════════════════════
 */
window.JCOMPASS_AUTH_READY = (async function () {
  const { CONFIG, Utils } = window.JC;
  const raw = Utils.store.get(CONFIG.SESSION_KEY, null);

  if (!raw || !raw.token) {
    window.location.replace(CONFIG.LOGIN_PAGE);
    return null;
  }

  // Local expiry check first (avoid a round-trip when we already know it's stale)
  const payload = Utils.decodeTokenPayload(raw.token);
  if (!payload || (payload.exp * 1000) < Date.now()) {
    Utils.store.del(CONFIG.SESSION_KEY);
    window.location.replace(CONFIG.LOGIN_PAGE);
    return null;
  }

  try {
    const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    const { data, error } = await sb.rpc('verify_session', { p_token: raw.token });
    if (error || !data || !data.ok) throw new Error('verify failed');

    const session = { user: data.user, token: raw.token };
    window.JCOMPASS_SESSION = session;
    document.documentElement.setAttribute('data-authenticated', '1');
    return session;
  } catch (e) {
    console.warn('JCompass auth-guard:', e.message);
    Utils.store.del(CONFIG.SESSION_KEY);
    window.location.replace(CONFIG.LOGIN_PAGE);
    return null;
  }
})();