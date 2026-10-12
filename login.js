/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Login Controller (v8.1)
 *  · Password show/hide toggle
 *  · Updated "Need help" message
 * ══════════════════════════════════════════════════════════════════════
 */
(function buildLoginDOM() {
  const UI = `
    <div class="login-hero">
      <div class="login-stars"></div>

      <nav class="login-nav">
        <div class="login-brand">
          <div class="login-brand-logo">
            <img src="favicon.ico" alt="Journalist's Compass" onerror="this.replaceWith('🧭')">
          </div>
          <span class="login-brand-name">Journalist's Compass</span>
        </div>
        <div class="login-nav-right">
          <span class="login-nav-badge">🔒 Secure Terminal</span>
        </div>
      </nav>

      <div class="login-stage">
        <div class="login-card" id="loginCard">
          <button class="login-card-close" id="loginCardClose" type="button" title="Clear form">✕</button>

          <div class="login-card-header">
            <h2 class="login-card-title">Login</h2>
            <p class="login-card-subtitle">Sign in to your Newsroom desk profile</p>
          </div>

          <div class="auth-error" id="authError" style="display:none;">Invalid credentials.</div>

          <form id="loginForm" autocomplete="on" novalidate>
            <div class="glass-field">
              <label for="username">Username</label>
              <input type="text" id="username" placeholder="e.g., Staff Correspondent" autocomplete="username" required>
              <span class="glass-field-icon">👤</span>
            </div>

            <div class="glass-field glass-field-password">
              <label for="password">Password</label>
              <input type="password" id="password" placeholder="••••••••" autocomplete="current-password" required>
              <button type="button" class="password-toggle" id="passwordToggle" aria-label="Show password" title="Show password">
                <span class="eye-icon eye-show">👁</span>
                <span class="eye-icon eye-hide" hidden>🙈</span>
              </button>
            </div>

            <div class="glass-options">
              <label class="glass-checkbox">
                <input type="checkbox" id="rememberMe">
                <span>Remember me</span>
              </label>
              <button type="button" class="glass-link" id="forgotBtn">Need help?</button>
            </div>

            <button type="submit" class="glass-submit" id="loginSubmitBtn">Login</button>
          </form>

          <div class="glass-footer">
            🔒 Accounts are issued and managed by Administrators.
          </div>
        </div>
      </div>

      <div class="login-loading-overlay" id="loginLoading">
        <div class="spinner"></div>
        <span>Authenticating…</span>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('afterbegin', UI);

  /* ── Password show/hide toggle ─────────────────────────────────── */
  const passInput = document.getElementById('password');
  const toggleBtn = document.getElementById('passwordToggle');
  if (passInput && toggleBtn) {
    const eyeShow = toggleBtn.querySelector('.eye-show');
    const eyeHide = toggleBtn.querySelector('.eye-hide');
    toggleBtn.addEventListener('click', () => {
      const isHidden = passInput.type === 'password';
      passInput.type = isHidden ? 'text' : 'password';
      if (eyeShow) eyeShow.hidden = isHidden;
      if (eyeHide) eyeHide.hidden = !isHidden;
      toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      toggleBtn.setAttribute('title', isHidden ? 'Hide password' : 'Show password');
      // Keep focus on the input so the user can keep typing
      passInput.focus();
    });
  }

  /* ── X button clears the form ──────────────────────────────────── */
  const closeBtn = document.getElementById('loginCardClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const u = document.getElementById('username');
      const p = document.getElementById('password');
      const err = document.getElementById('authError');
      if (u) u.value = '';
      if (p) { p.value = ''; p.type = 'password'; }
      if (err) err.style.display = 'none';
      // reset eye icons
      const show = document.querySelector('.password-toggle .eye-show');
      const hide = document.querySelector('.password-toggle .eye-hide');
      if (show) show.hidden = false;
      if (hide) hide.hidden = true;
      if (u) u.focus();
    });
  }

  /* ── "Need help?" shows the admin contact message ──────────────── */
  const forgotBtn = document.getElementById('forgotBtn');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      const t = document.getElementById('toast');
      if (!t) return;
      t.innerText = 'Contact your head administrator for help on your account.';
      t.classList.add('active');
      setTimeout(() => t.classList.remove('active'), 4000);
    });
  }
})();