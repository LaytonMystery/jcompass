/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Shared runtime config
 *  Load this BEFORE utils.js, auth.js, login.js, or app.js.
 * ══════════════════════════════════════════════════════════════════════
 */
window.JC = window.JC || {};

JC.CONFIG = {
  SUPABASE_URL:        'https://odqfqaywzwvxkvqptzxo.supabase.co',
  SUPABASE_ANON_KEY:   'sb_publishable_6CWGOKOIj4aXmRpidG6dVA_nYvcctoP',
  SESSION_KEY:         'jcompass_session',
  SESSION_DURATION_MS: 8 * 60 * 60 * 1000,
  LOGIN_PAGE:          'login.html',
  HOME_PAGE:           'index.html',
  PUSH_FN_URL:         'https://odqfqaywzwvxkvqptzxo.supabase.co/functions/v1/send-push',
  ONESIGNAL_APP_ID:    'e76cbe01-1a76-4f3d-a45d-9d155a126093',
  STORAGE_BUCKET:      'submissions',
  CACHE_VERSION:       'v6',
};

JC.CACHE_PREFIX = 'jcompass_' + JC.CONFIG.CACHE_VERSION + '_';