/**
 * ══════════════════════════════════════════════════════════════════════
 *  Journalist's Compass — Auth Guard
 *  Loaded synchronously in <head> on every protected page.
 *  Redirects to login.html if no valid session exists.
 * ══════════════════════════════════════════════════════════════════════
 */
(function () {
  const SESSION_KEY = 'jcompass_session';
  const LOGIN_PAGE  = 'login.html';

  function redirectToLogin(reason) {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    if (reason) console.warn('JCompass auth-guard:', reason);
    window.location.replace(LOGIN_PAGE);
  }

  let session = null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch (err) {
    redirectToLogin('corrupted session');
    return;
  }

  if (!session || !session.user || !session.user.name || !session.user.role) {
    redirectToLogin('no session');
    return;
  }

  if (!session.expiresAt || Date.now() > session.expiresAt) {
    redirectToLogin('session expired');
    return;
  }

  // Expose for app.js and mark document as authenticated
  window.JCOMPASS_SESSION = session;
  document.documentElement.setAttribute('data-authenticated', '1');
})();