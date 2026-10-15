/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Login Controller (v10)
 *  · Delegated submit listener (works regardless of DOM timing)
 *  · Reads the "Remember me" checkbox and passes it to Session.save
 *  · Falls back to hardcoded CONFIG if window.JC is missing
 * ══════════════════════════════════════════════════════════════════════
 */
(function () {
  'use strict';

  console.log('[JCompass] login.js loaded');

  /* ── Config: read from window.JC with hard fallback ────────────── */
  const CONFIG = (window.JC && window.JC.CONFIG) || {
    SUPABASE_URL: 'https://odqfqaywzwvxkvqptzxo.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP',
    SESSION_KEY: 'jcompass_session',
    LOGIN_PAGE: 'login.html',
    HOME_PAGE: 'index.html'
  };

  if (!window.JC || !window.JC.Session) {
    console.warn('[JCompass] window.JC.Session missing — auth.js may not have loaded');
  }

  /* ── Supabase client ──────────────────────────────────────────── */
  let supabaseClient = null;
  function initClient() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.supabase === 'undefined') {
      console.error('[JCompass] Supabase CDN not loaded');
      return null;
    }
    supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return supabaseClient;
  }
  initClient();

  /* ── Helpers ─────────────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }

  function showError(msg) {
    const el = $('authError');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
  function hideError() {
    const el = $('authError');
    if (el) el.style.display = 'none';
  }
  function setBusy(busy) {
    const btn = $('loginSubmitBtn');
    const loading = $('loginLoading');
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy ? 'Authenticating…' : 'Login';
    }
    if (loading) loading.classList.toggle('active', busy);
  }

  /* ── Persist session ─────────────────────────────────────────── */
  function saveSession(token, rememberMe) {
    // Prefer the shared Session manager if available
    if (window.JC && window.JC.Session && typeof window.JC.Session.save === 'function') {
      window.JC.Session.save(token, !!rememberMe);
      return;
    }
    // Fallback: write directly (localStorage if rememberMe, else sessionStorage)
    try {
      const payload = JSON.stringify({ token });
      localStorage.removeItem(CONFIG.SESSION_KEY);
      sessionStorage.removeItem(CONFIG.SESSION_KEY);
      if (rememberMe) localStorage.setItem(CONFIG.SESSION_KEY, payload);
      else sessionStorage.setItem(CONFIG.SESSION_KEY, payload);
    } catch (e) {
      console.error('[JCompass] Failed to write session:', e);
    }
  }

  /* ── Main login handler ──────────────────────────────────────── */
  let lockoutTimer = null;

  async function handleLogin(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    console.log('[JCompass] handleLogin fired');

    if (lockoutTimer) { console.warn('[JCompass] Still in lockout'); return; }
    hideError();

    const userInput = $('username');
    const passInput = $('password');
    if (!userInput || !passInput) { console.error('[JCompass] Input fields missing'); return; }

    const name = userInput.value.trim();
    const pass = passInput.value;
    console.log('[JCompass] Attempting login for:', JSON.stringify(name));

    if (!name || !pass) {
      showError('Both username and password are required.');
      return;
    }

    const sb = initClient();
    if (!sb) {
      showError('Authentication library not loaded. Refresh the page.');
      return;
    }

    setBusy(true);

    try {
      const { data, error } = await sb.rpc('verify_login', { p_name: name, p_pass: pass });
      console.log('[JCompass] RPC response:', { data, error });

      if (error) {
        console.error('[JCompass] RPC error:', error);
        showError('Backend error: ' + (error.message || 'unknown'));
        setBusy(false);
        return;
      }

      if (data && data.error === 'locked') {
        setBusy(false);
        const wait = data.retry_after_seconds || 120;
        startLockoutCountdown(wait);
        return;
      }

      if (!data || !data.ok || !data.token) {
        setBusy(false);
        const left = data && typeof data.attempts_remaining === 'number' ? data.attempts_remaining : null;
        if (left === 0) startLockoutCountdown(120);
        else if (left === 1) showError('Invalid credentials. 1 attempt remaining before temporary lockout.');
        else if (left === 2) showError('Invalid credentials. 2 attempts remaining.');
        else showError('Invalid credentials.');
        return;
      }

      console.log('[JCompass] Login OK, saving session');
      const rememberMe = !!document.getElementById('rememberMe')?.checked;
      saveSession(data.token, rememberMe);
      userInput.value = '';
      passInput.value = '';

      console.log('[JCompass] Redirecting to', CONFIG.HOME_PAGE);
      window.location.replace(CONFIG.HOME_PAGE);
    } catch (err) {
      console.error('[JCompass] Login exception:', err);
      showError('Unexpected error: ' + (err.message || 'unknown'));
      setBusy(false);
    }
  }

  /* ── Lockout countdown ───────────────────────────────────────── */
  function startLockoutCountdown(seconds) {
    let remaining = Math.max(1, Math.floor(seconds));
    const btn = $('loginSubmitBtn');
    if (!btn) return;
    if (lockoutTimer) clearInterval(lockoutTimer);
    btn.disabled = true;

    const tick = () => {
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2, '0');
      const label = m > 0 ? `${m}:${s}` : `${s}s`;
      showError('Too many failed attempts. Try again in ' + label + '.');
      btn.textContent = 'Locked — ' + label;
      if (remaining <= 0) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
        btn.disabled = false;
        btn.textContent = 'Login';
        showError('You can try again now.');
      }
      remaining--;
    };
    tick();
    lockoutTimer = setInterval(tick, 1000);
  }

  /* ── Delegated submit listener ─────────────────────────────────── */
  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'loginForm') {
      console.log('[JCompass] Submit event intercepted for #loginForm');
      handleLogin(e);
    }
  }, true);

  /* ── Enter-key support ────────────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target && (e.target.id === 'username' || e.target.id === 'password')) {
      e.preventDefault();
      const form = $('loginForm');
      if (form) form.requestSubmit();
    }
  }, true);

  /* ── Password toggle ──────────────────────────────────────────── */
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('#passwordToggle');
    if (!toggle) return;
    const pass = $('password');
    if (!pass) return;
    const isHidden = pass.type === 'password';
    pass.type = isHidden ? 'text' : 'password';
    const show = toggle.querySelector('.eye-show');
    const hide = toggle.querySelector('.eye-hide');
    if (show) show.hidden = isHidden;
    if (hide) hide.hidden = !isHidden;
    pass.focus();
  });

  /* ── Clear form ───────────────────────────────────────────────── */
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('#loginCardClose');
    if (!closeBtn) return;
    const u = $('username'); const p = $('password');
    if (u) u.value = '';
    if (p) { p.value = ''; p.type = 'password'; }
    hideError();
  });

  /* ── "Need help?" ─────────────────────────────────────────────── */
  document.addEventListener('click', (e) => {
    const helpBtn = e.target.closest('#forgotBtn');
    if (!helpBtn) return;
    const t = $('toast');
    if (!t) return;
    t.innerText = 'Contact your head administrator for help on your account.';
    t.classList.add('active');
    setTimeout(() => t.classList.remove('active'), 4000);
  });

  /* ── Skip if already authenticated ────────────────────────────── */
  (async () => {
    try {
      if (window.JC && window.JC.Session && typeof window.JC.Session.verify === 'function') {
        const s = await window.JC.Session.verify();
        if (s) {
          console.log('[JCompass] Already authenticated, redirecting');
          window.location.replace(CONFIG.HOME_PAGE);
        }
      }
    } catch (err) {
      console.warn('[JCompass] skipIfAuthenticated failed silently:', err);
    }
  })();

  console.log('JCompass: login controller ready.');
})();