/**
 * JCompass — Session Manager
 * Full version with verify(), save(), requireOrRedirect(), isAdmin()
 */
(function () {
  const { CONFIG, Utils } = window.JC;
  const S = window.JC.Session = {};

  let cached = null;
  let verifying = null;
  let client = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase) return null;
    client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return client;
  }

  const readRaw = () => Utils.store.get(CONFIG.SESSION_KEY, null);

  S.verify = function () {
    if (cached) return Promise.resolve(cached);
    if (verifying) return verifying;

    const raw = readRaw();
    if (!raw || !raw.token) return Promise.resolve(null);

    const payload = Utils.decodeTokenPayload(raw.token);
    if (!payload || (payload.exp * 1000) < Date.now()) {
      S.logout();
      return Promise.resolve(null);
    }

    const sb = getClient();
    if (!sb) { S.logout(); return Promise.resolve(null); }

    verifying = sb.rpc('verify_session', { p_token: raw.token }).then(({ data, error }) => {
      verifying = null;
      if (error || !data || !data.ok) { S.logout(); return null; }
      cached = { user: data.user, token: raw.token, exp: payload.exp };
      return cached;
    }).catch(() => {
      verifying = null;
      S.logout();
      return null;
    });

    return verifying;
  };

  S.get       = () => cached;
  S.user      = () => cached ? cached.user : null;
  S.getToken  = () => cached ? cached.token : (readRaw() || {}).token || null;
  S.isAdmin   = () => !!cached && cached.user && cached.user.role === 'ADMIN';
  S.save      = (token) => { Utils.store.set(CONFIG.SESSION_KEY, { token }); cached = null; };
  S.logout    = () => { Utils.store.del(CONFIG.SESSION_KEY); cached = null; };

  S.requireOrRedirect = async function () {
    const s = await S.verify();
    if (!s) { window.location.replace(CONFIG.LOGIN_PAGE); throw new Error('unauthenticated'); }
    return s;
  };
})();