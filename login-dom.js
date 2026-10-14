/**
 * ══════════════════════════════════════════════════════════════════════
 *  Sentinel JCompass — Login DOM Builder
 *  Split card · two-logo lockup · dark palette
 *  Mobile: hides brand panel, shows compact brand header in form
 * ══════════════════════════════════════════════════════════════════════
 */
(function buildLoginDOM() {
  const UI = `
    <div class="login-shell">
      <div class="login-card" id="loginCard">

        <aside class="login-brand">
          <div class="login-brand-overlay"></div>

          <div class="brand-lockup">
            <div class="brand-lockup-logos">
              <div class="brand-logo brand-logo-main">
                <img src="logo.png" alt="JCompass"
                  onerror="this.onerror=null;this.src='favicon.ico';this.onerror=()=>{this.parentElement.innerHTML='<span style=&quot;font-size:1.6rem;&quot;>🧭</span>';}">
              </div>
              <div class="brand-logo brand-logo-seal">
                <img src="logo2.png" alt="Organization"
                  onerror="this.parentElement.style.display='none';">
              </div>
            </div>
            <div class="brand-text">
              <div class="brand-wordmark">Sentinel Journalist Compass</div>
              <div class="brand-tagline">Editorial Operations Portal</div>
            </div>
          </div>

          <div class="brand-lede">
            <div class="brand-kicker">Editorial Operations</div>
            <h1 class="brand-heading">Every story,<br><span class="hl">on record.</span></h1>
            <div class="brand-rule"></div>
            <p class="brand-paragraph">
              Coordinate reporters, monitor deadlines, and keep every project on track.
              <span class="accent">Built for newsrooms of every size.</span>
            </p>
          </div>
        </aside>

        <main class="login-form">
          <button class="login-close" id="loginCardClose" type="button" title="Clear form">✕</button>

          <div class="form-inner">

            <div class="mobile-brand" aria-hidden="true">
              <div class="mobile-brand-logos">
                <div class="brand-logo brand-logo-main">
                  <img src="logo.png" alt="JCompass"
                    onerror="this.onerror=null;this.src='favicon.ico';this.onerror=()=>{this.parentElement.innerHTML='<span style=&quot;font-size:1.4rem;&quot;>🧭</span>';}">
                </div>
                <div class="brand-logo brand-logo-seal">
                  <img src="logo2.png" alt="Organization"
                    onerror="this.parentElement.style.display='none';">
                </div>
              </div>
              <div class="mobile-brand-wordmark">Sentinel Journalist Compass</div>
              <div class="mobile-brand-tagline">Editorial Operations Portal</div>
            </div>

            <h2 class="form-title">Welcome back!</h2>
            <p class="form-subtitle">Sign in to continue to your <b id="portalName">newsroom desk</b></p>

            <div class="auth-error" id="authError" style="display:none;">Invalid credentials.</div>

            <form id="loginForm" autocomplete="on" novalidate>
              <div class="form-field">
                <label for="username">Username</label>
                <div class="input-wrap">
                  <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <input type="text" id="username" placeholder="e.g., Staff Correspondent" autocomplete="username" required>
                </div>
              </div>

              <div class="form-field">
                <div class="field-label-row">
                  <label for="password">Password</label>
                  <button type="button" class="forgot-link" id="forgotBtn">Need help?</button>
                </div>
                <div class="input-wrap">
                  <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <input type="password" id="password" placeholder="Enter your password" autocomplete="current-password" required>
                  <button type="button" class="password-toggle" id="passwordToggle" aria-label="Show password" title="Show password">
                    <span class="eye-icon eye-show">👁</span>
                    <span class="eye-icon eye-hide" hidden>🙈</span>
                  </button>
                </div>
              </div>

              <label class="remember-check">
                <input type="checkbox" id="rememberMe">
                <span>Remember me on this device</span>
              </label>

              <button type="submit" class="login-btn" id="loginSubmitBtn">
                <span id="loginBtnLabel">Login</span>
              </button>
            </form>

            <div class="form-sep"><span>Accounts</span></div>
            <p class="form-foot">🔒 Accounts are issued and managed by Administrators.</p>
          </div>
        </main>

      </div>
    </div>

    <div class="login-loading-overlay" id="loginLoading">
      <div class="spinner"></div>
      <span>Authenticating…</span>
    </div>
  `;

  document.body.insertAdjacentHTML('afterbegin', UI);
})();