/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Login DOM Builder (glass hero layout)
 *  Loaded before login.js. Builds a full-screen hero with a glass card.
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

            <div class="glass-field">
              <label for="password">Password</label>
              <input type="password" id="password" placeholder="••••••••" autocomplete="current-password" required>
              <span class="glass-field-icon">🔒</span>
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

  /* ── Small UI-only wiring (login.js handles the real auth) ──── */

  // X button clears the form and refocuses username
  const closeBtn = document.getElementById('loginCardClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const u = document.getElementById('username');
      const p = document.getElementById('password');
      const err = document.getElementById('authError');
      if (u) u.value = '';
      if (p) p.value = '';
      if (err) err.style.display = 'none';
      if (u) u.focus();
    });
  }

  // "Need help?" shows a friendly toast
  const forgotBtn = document.getElementById('forgotBtn');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      const t = document.getElementById('toast');
      if (!t) return;
      t.innerText = 'Contact your Administrator for account help.';
      t.classList.add('active');
      setTimeout(() => t.classList.remove('active'), 3000);
    });
  }
})();