/**
 * JCompass — Firebase Cloud Messaging integration
 * Loaded after app.js on index.html only.
 * The FCM token is persisted via the `register_fcm_token` RPC, which
 * validates the caller's session token server-side. Do not write
 * directly to the users table from the client.
 */
(function () {
  'use strict';

  console.log('[FCM] fcm.js loaded');

  let messaging = null;
  let registrationInFlight = false;

  function initFirebase() {
    if (messaging) return messaging;
    if (typeof firebase === 'undefined') {
      console.warn('[FCM] Firebase SDK not loaded');
      return null;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      messaging = firebase.messaging();
      return messaging;
    } catch (e) {
      console.error('[FCM] init failed:', e);
      return null;
    }
  }

  function waitForApp() {
    return new Promise(resolve => {
      if (window.generateDashboardStats && window.JC && window.JC.Session) return resolve();
      const iv = setInterval(() => {
        if (window.generateDashboardStats && window.JC && window.JC.Session) {
          clearInterval(iv);
          resolve();
        }
      }, 150);
      setTimeout(() => { clearInterval(iv); resolve(); }, 8000);
    });
  }

  async function registerFCMToken() {
    if (registrationInFlight) return null;
    registrationInFlight = true;

    try {
      const m = initFirebase();
      if (!m) return null;

      if (!window.JC || !window.JC.Session) return null;
      const user = window.JC.Session.user();
      if (!user) {
        console.log('[FCM] No session yet — skipping');
        return null;
      }

      const CONFIG = window.JC.CONFIG;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        console.log('[FCM] Permission not granted:', permission);
        return null;
      }

      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('[FCM] SW registered:', swReg.scope);

      const token = await m.getToken({
        vapidKey: window.FCM_VAPID_KEY,
        serviceWorkerRegistration: swReg
      });

      if (!token) {
        console.warn('[FCM] Empty token');
        return null;
      }
      console.log('[FCM] Token:', token.slice(0, 25) + '…');

      /* ── Persist the token via the session-validated RPC ────────── */
      const sessionToken = (window.JC.Session && window.JC.Session.getToken)
        ? window.JC.Session.getToken()
        : null;

      if (!sessionToken) {
        console.warn('[FCM] No session token — skipping token save.');
        return null;
      }

      const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      const { data, error } = await sb.rpc('register_fcm_token', {
        p_token: sessionToken,
        p_fcm_token: token
      });

      if (error) {
        console.error('[FCM] Token save failed:', error);
      } else if (data && data.ok) {
        console.log('[FCM] Token saved for', user.name);
      } else {
        console.warn('[FCM] Token save rejected:', data);
      }

      return token;
    } catch (e) {
      console.error('[FCM] registerFCMToken error:', e);
      return null;
    } finally {
      registrationInFlight = false;
    }
  }

  function wireForeground() {
    const m = initFirebase();
    if (!m) return;
    m.onMessage((payload) => {
      const title = (payload.notification && payload.notification.title) || 'JCompass';
      const body  = (payload.notification && payload.notification.body)  || '';
      console.log('[FCM] Foreground:', title, '—', body);
      if (typeof window.triggerNotificationToast === 'function') {
        window.triggerNotificationToast(title + ' — ' + body);
      }
    });
  }

  /* Override the app's sendPushNotification to route through our Edge Function */
  window.sendPushNotification = async function (title, message, targetUserName) {
    const CONFIG = window.JC && window.JC.CONFIG;
    if (!CONFIG) return;
    try {
      const res = await fetch(CONFIG.PUSH_FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, message, targetUserName: targetUserName || null })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) console.warn('[Push] failed:', json);
      return json;
    } catch (err) {
      console.error('[Push] exception:', err);
    }
  };

  window.JC = window.JC || {};
  window.JC.registerFCM = registerFCMToken;
  window.JC.wireFCMForeground = wireForeground;

  /* Tap the bell → also register FCM */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#topbarBell')) return;
    setTimeout(() => {
      registerFCMToken().catch(err => console.warn('[FCM] bell-triggered register failed:', err));
    }, 200);
  }, true);

  /* Boot */
  (async function boot() {
    await waitForApp();
    await new Promise(r => setTimeout(r, 800));

    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      console.log('[FCM] Native platform — web FCM skipped');
      return;
    }

    if (!window.JC || !window.JC.Session || typeof window.JC.Session.verify !== 'function') {
      console.warn('[FCM] No Session API');
      return;
    }

    try {
      const session = await window.JC.Session.verify();
      if (!session) {
        console.log('[FCM] No active session');
        return;
      }
      wireForeground();
      registerFCMToken().catch(e => console.warn('[FCM] auto-register failed:', e));
    } catch (e) {
      console.warn('[FCM] boot error:', e);
    }
  })();
})();