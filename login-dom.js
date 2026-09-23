/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Login DOM Builder
 *  Builds the login page UI at runtime. Loaded before login.js.
 * ══════════════════════════════════════════════════════════════════════
 */
(function buildLoginDOM() {
  const UI = `
    <div class="auth-screen">
      <div class="auth-container">
        <div class="auth-graphic-side">
          <div class="graphic-gradient-overlay"></div>
          <div class="graphic-content">
            <div class="graphic-logo">🧭</div>
            <h2 class="graphic-title">Journalist's Compass</h2>
            <p class="graphic-tagline">Centralized secure terminal for operations telemetry, editorial dispatch pipelines, and field correspondence networks.</p>
            <div class="graphic-badge-row">
              <span class="g-badge">Secure Terminal</span>
              <span class="g-badge">Newsroom v2.0</span>
            </div>
          </div>
        </div>
        <div class="auth-form-side">
          <div id="authViewLogin" class="auth-view-wrapper active">
            <div class="auth-form-header">
              <h3 class="auth-form-title">Welcome Back</h3>
              <p class="auth-form-subtitle">Sign in to your Newsroom desk profile</p>
            </div>
            <div class="auth-error" id="authError" style="display:none;">Invalid credentials.</div>
            <form id="loginForm" autocomplete="on" novalidate>
              <div class="auth-field">
                <label class="form-label" for="username">Username</label>
                <input type="text" id="username" class="auth-input" placeholder="e.g., Staff Correspondent" autocomplete="username" required>
              </div>
              <div class="auth-field">
                <label class="form-label" for="password">Password</label>
                <input type="password" id="password" class="auth-input" placeholder="••••••••" autocomplete="current-password" required>
              </div>
              <button type="submit" class="btn btn-primary auth-submit-btn" id="loginSubmitBtn">Authenticate Session</button>
            </form>
            <p style="font-size:0.75rem; color:var(--text-muted); text-align:center; margin-top:1rem; line-height:1.5;">
              🔒 Accounts are issued and managed by Administrators.
            </p>
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
})();