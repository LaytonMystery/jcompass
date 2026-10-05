/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Login Controller (v8)
 *  • 3-strike lockout with live countdown
 *  • Lockout persists across page refresh
 * ══════════════════════════════════════════════════════════════════════
 */
(function () {
  const { CONFIG, Session } = window.JC;
  const LOCKOUT_KEY = 'jcompass_lockout';

  const form      = document.getElementById('loginForm');
  const userInput = document.getElementById('username');
  const passInput = document.getElementById('password');
  const errorBox  = document.getElementById('authError');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const loading   = document.getElementById('loginLoading');

  if (!window.supabase) {
    errorBox.textContent = 'Authentication library failed to load. Refresh the page.';
    errorBox.style.display = 'block';
    return;
  }

  const supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  let lockoutTimer = null;

  const showError = m => { errorBox.textContent = m; errorBox.style.display = 'block'; };
  const hideError = () => { errorBox.style.display = 'none'; };
  const setBusy = b => {
    submitBtn.disabled = b;
    submitBtn.textContent = b ? 'Authenticating…' : 'Login';
    if (loading) loading.classList.toggle('active', b);
  };

  /* ── Persist lockout across reloads ─────────────────────────────── */
  function saveLockout(name, seconds) {
    try {
      localStorage.setItem(LOCKOUT_KEY, JSON.stringify({
        name, until: Date.now() + seconds * 1000
      }));
    } catch {}
  }
  function clearLockout() {
    try { localStorage.removeItem(LOCKOUT_KEY); } catch {}
  }
  function restoreLockoutIfAny() {
    let raw;
    try { raw = localStorage.getItem(LOCKOUT_KEY); } catch {}
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch { clearLockout(); return; }
    const remaining = Math.ceil((data.until - Date.now()) / 1000);
    if (remaining > 0) {
      if (userInput && data.name) userInput.value = data.name;
      startLockoutCountdown(remaining);
    } else {
      clearLockout();
    }
  }

  function startLockoutCountdown(seconds) {
    let remaining = Math.max(1, Math.floor(seconds));
    if (lockoutTimer) clearInterval(lockoutTimer);
    submitBtn.disabled = true;

    const tick = () => {
      const m = Math.floor(remaining / 60);
      const s = String(remaining % 60).padStart(2, '0');
      const label = m > 0 ? `${m}:${s}` : `${s}s`;
      showError(`Too many failed attempts. Try again in ${label}.`);
      submitBtn.textContent = `Locked — ${label}`;

      if (remaining <= 0) {
        clearInterval(lockoutTimer);
        lockoutTimer = null;
        clearLockout();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Login';
        showError('You can try again now.');
      }
      remaining--;
    };
    tick();
    lockoutTimer = setInterval(tick, 1000);
  }

  async function handleLogin(e) {
    if (e) e.preventDefault();
    if (lockoutTimer) return;  // still counting down
    hideError();

    const name = userInput.value.trim();
    const pass = passInput.value;
    if (!name || !pass) { showError('Both username and password are required.'); return; }

    setBusy(true);

    try {
      const { data, error } = await supabaseClient.rpc('verify_login', { p_name: name, p_pass: pass });

      if (error) {
        console.error('Supabase auth error:', error);
        showError('Unable to reach authentication service. Please try again.');
        setBusy(false);
        return;
      }

      /* ── Locked out ───────────────────────────────────────────── */
      if (data && data.error === 'locked') {
        setBusy(false);
        const wait = data.retry_after_seconds || 120;
        saveLockout(name, wait);
        startLockoutCountdown(wait);
        return;
      }

      /* ── Wrong password ───────────────────────────────────────── */
      if (!data || !data.ok) {
        setBusy(false);
        const left = data && typeof data.attempts_remaining === 'number'
          ? data.attempts_remaining
          : null;

        if (left === 0) {
          saveLockout(name, 120);
          startLockoutCountdown(120);
        } else if (left === 1) {
          showError('Invalid credentials. 1 attempt remaining before temporary lockout.');
        } else if (left === 2) {
          showError('Invalid credentials. 2 attempts remaining.');
        } else {
          showError('Invalid credentials.');
        }
        return;
      }

      /* ── Success ──────────────────────────────────────────────── */
      clearLockout();
      Session.save(data.token);
      userInput.value = '';
      passInput.value = '';
      window.location.replace(CONFIG.HOME_PAGE);
    } catch (err) {
      console.error('Login exception:', err);
      showError('Unexpected error. Please try again.');
      setBusy(false);
    }
  }

  form.addEventListener('submit', handleLogin);
  [userInput, passInput].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  }));

  /* ── On page load: restore any active lockout ───────────────────── */
  restoreLockoutIfAny();

  /* ── When the user changes the username, re-check for a stored lock */
  userInput?.addEventListener('input', () => {
    let raw;
    try { raw = localStorage.getItem(LOCKOUT_KEY); } catch {}
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      if (data.name && data.name.toLowerCase() === userInput.value.trim().toLowerCase()) {
        const remaining = Math.ceil((data.until - Date.now()) / 1000);
        if (remaining > 0 && !lockoutTimer) startLockoutCountdown(remaining);
      }
    } catch {}
  });

  console.log('JCompass: login controller ready.');
})();