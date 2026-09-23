/**
 * ══════════════════════════════════════════════════════════════════════
 *  Journalist's Compass — Login Controller
 *  Validates credentials against the Supabase `users` table ONLY.
 *  No hardcoded fallback accounts. If Supabase is unreachable, login fails.
 * ══════════════════════════════════════════════════════════════════════
 */

const SUPABASE_URL = 'https://odqfqaywzwvxkvqptzxo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP';

const SESSION_KEY = 'jcompass_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

const form       = document.getElementById('loginForm');
const userInput  = document.getElementById('username');
const passInput  = document.getElementById('password');
const errorBox   = document.getElementById('authError');
const submitBtn  = document.getElementById('loginSubmitBtn');
const loadingBox = document.getElementById('loginLoading');

// ⚠️ Renamed from `supabase` to avoid collision with window.supabase (the CDN global)
let supabaseClient = null;

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}
function hideError() { errorBox.style.display = 'none'; }

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.textContent = busy ? 'Authenticating…' : 'Authenticate Session';
  loadingBox.classList.toggle('active', busy);
}

async function handleLogin(e) {
  if (e) e.preventDefault();
  hideError();

  const name = userInput.value.trim();
  const pass = passInput.value.trim();

  if (!name || !pass) {
    showError('Both username and password are required.');
    return;
  }

  if (!supabaseClient) {
    showError('Authentication service is unavailable. Check your connection.');
    return;
  }

  setBusy(true);

  try {
    let row = null;

    // Preferred: server-side RPC
    const rpc = await supabaseClient.rpc('verify_login', { p_name: name, p_pass: pass });

    if (!rpc.error) {
      const data = rpc.data;
      row = Array.isArray(data) ? data[0] : data;
    } else {
      // Fallback: direct table read (only works if you kept the select policy)
      const q = await supabaseClient
        .from('users')
        .select('id, name, pass, role, code')
        .eq('name', name)
        .limit(1)
        .maybeSingle();

      if (q.error) {
        console.error('Supabase auth error:', q.error);
        showError('Unable to reach authentication service. Please try again.');
        setBusy(false);
        return;
      }
      if (q.data && q.data.pass === pass) {
        row = { id: q.data.id, name: q.data.name, role: q.data.role, code: q.data.code };
      }
    }

    if (!row || !row.name || !row.role) {
      showError('Invalid credentials.');
      setBusy(false);
      return;
    }

    const session = {
      user: {
        id:   row.id,
        name: row.name,
        code: row.code,
        role: row.role
      },
      issuedAt:  Date.now(),
      expiresAt: Date.now() + SESSION_DURATION_MS
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem('jcompass_user');

    userInput.value = '';
    passInput.value = '';

    window.location.replace('index.html');

  } catch (err) {
    console.error('Login exception:', err);
    showError('Unexpected error. Please try again.');
    setBusy(false);
  }
}

// Submit button + Enter keys
form.addEventListener('submit', handleLogin);
[userInput, passInput].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      form.requestSubmit();
    }
  });
});

// Skip login if already authenticated
(function skipIfAuthenticated() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s && s.user && s.expiresAt && Date.now() < s.expiresAt) {
      window.location.replace('/');
    }
  } catch { /* ignore */ }
})();

// Boot
(function boot() {
  if (typeof window.supabase === 'undefined') {
    showError('Authentication library failed to load. Refresh the page.');
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log('JCompass: login controller ready.');
})();