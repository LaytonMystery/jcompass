/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Session Manager
 *  Defines the Session object used by app.js and auth-guard.js.
 * ══════════════════════════════════════════════════════════════════════
 */
(function() {
  const { CONFIG } = window.JC || {};
  if (!CONFIG) return;

  window.JC.Session = {
    getToken: function() {
      try {
        const raw = localStorage.getItem(CONFIG.SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw).token || null;
      } catch (e) { return null; }
    },
    getUser: function() {
      try {
        const raw = localStorage.getItem(CONFIG.SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw).user || null;
      } catch (e) { return null; }
    },
    logout: function() {
      localStorage.removeItem(CONFIG.SESSION_KEY);
    }
  };
})();