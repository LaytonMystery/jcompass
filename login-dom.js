/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Login DOM Builder
 *  Split-card layout · two-logo brand lockup · light theme
 * ══════════════════════════════════════════════════════════════════════
 */
(function buildLoginDOM() {
  const UI = `
    <div class="login-shell">
      <div class="login-card" id="loginCard">

        <!-- ═══ LEFT — dark teal graphic panel ═══ -->
        <div class="login-card-graphic">
          <div class="brand-lockup">
            <div class="brand-lockup-logos">
              <div class="brand-logo">
                <img src="logo.png" alt="JCompass"
                  onerror="this.onerror=null;this.src='favicon.ico';this.onerror=()=>{this.parentElement.innerHTML='<span style=&quot;font-size:1.4rem;&quot;>🧭</span>';}">
              </div>
              <div class="brand-logo" id="brandLogo2">
                <img src="logo2.png" alt="Organization"
                  onerror="this.parentElement.style.display='none';">
              </div>
            </div>
            <div class="brand-text">
              <div class="brand-name">Journalist's Compass</div>
              <div class="brand-sub">Editorial Operations Portal</div>
            </div>
          </div>

          <div class="graphic-content">
            <div class="graphic-eyebrow">EDITORIAL OPERATIONS</div>
            <h2 class="graphic-heading">Every story,<br><span class="accent">on record.</span></h2>
            <p class="graphic-tagline">From field coverage to final dispatch — coordinate reporters, monitor deadlines, and keep every project on track.</p>
            <p class="graphic-emphasis">Built for newsrooms of every size.</p>
          </div>
        </div>

        <!-- ═══ RIGHT — white form panel ═══ -->
        <div class="login-card-form">
          <button class="login-card-close" id="loginCardClose" type="button" title="Clear form">✕</button>

          <div class="form-header">
            <h2 class="form-title">Welcome back!</h2>
            <p class="form-subtitle">Sign in to continue to your newsroom desk</p>
          </div>

          <!-- Informational role chips (non-interactive) -->
          <div class="role-chips" aria-label="Roles with access">
            <div class="role-chip">
              <div class="role-icon">🔑</div>
              <div class="role-text">
                <div class="role-name">Admin</div>
                <div class="role-desc">System access</div>
              </div>
            </div>
            <div class="role-chip">
              <div class="role-icon">✏️</div>
              <div class="role-text">
                <div class="role-name">Editor</div>
                <div class="role-desc">Editorial lead</div>
              </div>
            </div>
            <div class="role-chip">
              <div class="role-icon">📰</div>
              <div class="role-text">
                <div class="role-name">Staff</div>
                <div class="role-desc">Field reporter</div>
              </div>
            </div>
          </div>

          <div class="auth-error" id="authError" style="display:none;">Invalid credentials.</div>

          <form id="loginForm" autocomplete="on" novalidate>
            <div class="form-field">
              <label for="username">Username</label>
              <div class="input-wrap">
                <span class="input-icon">👤</span>
                <input type="text" id="username" placeholder="e.g., Staff Correspondent" autocomplete="username" required>
              </div>
            </div>

            <div class="form-field">
              <div class="label-row">
                <label for="password">Password</label>
                <button type="button" class="forgot-link" id="forgotBtn">Need help?</button>
              </div>
              <div class="input-wrap">
                <span class="input-icon">🔒</span>
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

            <button type="submit" class="login-btn" id="loginSubmitBtn">Login</button>
          </form>

          <div class="form-footer">
            <div class="footer-divider"><span>Accounts</span></div>
            <p>🔒 Accounts are issued and managed by Administrators.</p>
          </div>
        </div>

      </div>
    </div>

    <div class="login-loading-overlay" id="loginLoading">
      <div class="spinner"></div>
      <span>Authenticating…</span>
    </div>
  `;

  document.body.insertAdjacentHTML('afterbegin', UI);
})();