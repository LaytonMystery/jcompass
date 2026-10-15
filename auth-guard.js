/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Auth Guard (fail-closed)
 *  Loaded in <head> on every protected page. Kicks off server-side
 *  session verification. If verification fails for ANY reason
 *  (network error, RPC missing, token invalid, session expired),
 *  the local session is cleared and the user is redirected to login.
 *
 *  Dev escape hatch (opt-in, both conditions required):
 *    · running on localhost / 127.0.0.1 / 0.0.0.0
 *    · CONFIG.DEV_ALLOW_UNVERIFIED_SESSION === true
 * ══════════════════════════════════════════════════════════════════════
 */
window.JCOMPASS_AUTH_READY = (async function () {
  const { CONFIG, Utils, Session } = window.JC;

  const redirectToLogin = (reason) => {
    console.warn('[auth-guard] redirecting to login:', reason);
    try { Session.logout(); } catch {}
    window.location.replace(CONFIG.LOGIN_PAGE);
    return null;
  };

  const isDev = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
  const allowDevFallback = isDev && CONFIG.DEV_ALLOW_UNVERIFIED_SESSION === true;

  /* Read from whichever storage holds the token (session or local). */
  let raw = null;
  try { raw = Session.readRaw ? Session.readRaw() : Utils.store.get(CONFIG.SESSION_KEY, null); }
  catch { raw = null; }

  if (!raw || !raw.token) return redirectToLogin('no session token');

  /* Cheap local expiry check first — avoids a useless round-trip. */
  const payload = Utils.decodeTokenPayload(raw.token);
  if (!payload || (payload.exp * 1000) < Date.now()) {
    return redirectToLogin('token expired or malformed');
  }

  /* Server-side verification. Fail closed on ANY error. */
  try {
    const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    const { data, error } = await sb.rpc('verify_session', { p_token: raw.token });

    if (error) {
      // Missing RPC is the one case we tolerate in dev — production fails closed.
      const rpcMissing = /function .* does not exist/i.test(error.message || '');
      if (allowDevFallback && rpcMissing) {
        console.warn('[auth-guard] DEV MODE: verify_session RPC missing; using offline session.');
        window.JCOMPASS_SESSION = { user: raw.user || { name: 'DEV', role: 'ADMIN', code: 'DEV' }, token: raw.token };
        document.documentElement.setAttribute('data-authenticated', '1');
        return window.JCOMPASS_SESSION;
      }
      return redirectToLogin('verify_session error: ' + (error.message || 'unknown'));
    }

    if (!data || !data.ok || !data.user) {
      return redirectToLogin('verify_session returned not-ok');
    }

    window.JCOMPASS_SESSION = { user: data.user, token: raw.token };
    document.documentElement.setAttribute('data-authenticated', '1');
    return window.JCOMPASS_SESSION;

  } catch (e) {
    if (allowDevFallback) {
      console.warn('[auth-guard] DEV MODE: verify_session threw; using offline session.', e);
      window.JCOMPASS_SESSION = { user: raw.user || { name: 'DEV', role: 'ADMIN', code: 'DEV' }, token: raw.token };
      document.documentElement.setAttribute('data-authenticated', '1');
      return window.JCOMPASS_SESSION;
    }
    return redirectToLogin('verify_session threw: ' + (e && e.message));
  }
})();