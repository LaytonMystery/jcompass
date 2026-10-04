/**
 * JCompass — Login Controller (v6)
 * Token-based auth. No client-side password comparison.
 */
(function () {
  const { CONFIG, Session } = window.JC;

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

  const showError = m => { errorBox.textContent = m; errorBox.style.display = 'block'; };
  const hideError = () => { errorBox.style.display = 'none'; };
  const setBusy = b => {
    submitBtn.disabled = b;
    submitBtn.textContent = b ? 'Authenticating…' : 'Authenticate Session';
    if (loading) loading.classList.toggle('active', b);
  };

  async function handleLogin(e) {
    if (e) e.preventDefault();
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
      if (!data || !data.ok || !data.token) {
        showError('Invalid credentials.');
        setBusy(false);
        return;
      }

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

  console.log('JCompass: login controller ready.');
})();