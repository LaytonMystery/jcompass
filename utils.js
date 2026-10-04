/**
 * ══════════════════════════════════════════════════════════════════════
 *  JCompass — Utilities
 *  escapeHtml, DOM helpers, dates, storage, file upload.
 * ══════════════════════════════════════════════════════════════════════
 */
(function () {
  const U = window.JC.Utils = {};

  /* ── XSS escape ────────────────────────────────────────────────── */
  const HTML_ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  U.escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => HTML_ENT[c]);

  /* ── Safe DOM builder ──────────────────────────────────────────── */
  U.el = function (tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  /* ── Dates ─────────────────────────────────────────────────────── */
  U.todayLocalISO = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  U.fmtDate = (iso, opts) => iso ? new Date(iso).toLocaleDateString('en-US', opts) : '—';
  U.fmtTime = (d, opts) => (d || new Date()).toLocaleTimeString('en-US',
    opts || { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  U.fmtDateTime = iso => iso ? new Date(iso).toLocaleString('en-US') : '—';

  /* ── LocalStorage ─────────────────────────────────────────────── */
  U.store = {
    get(key, fallback = null) {
      try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
      catch { try { localStorage.removeItem(key); } catch {} return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('store.set failed', e); } },
    del(key) { try { localStorage.removeItem(key); } catch {} },
  };

  /* ── File uploads → Supabase Storage ──────────────────────────── */
  U.uploadFile = async (supabase, bucket, folder, file) => {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) throw new Error('File too large (max 5 MB).');
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type
    });
    if (error) throw error;
    return path;
  };

  U.signedUrl = async (supabase, bucket, path, expires = 3600) => {
    if (!path) return null;
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expires);
    return error ? null : data.signedUrl;
  };

  /* ── Base64url → JSON (client-side payload peek only) ─────────── */
  U.decodeTokenPayload = token => {
    try {
      const b64 = token.split('.')[0];
      const norm = b64.replace(/-/g, '+').replace(/_/g, '/')
        .padEnd(Math.ceil(b64.length / 4) * 4, '=');
      return JSON.parse(atob(norm));
    } catch { return null; }
  };

  /* ── Small helpers ────────────────────────────────────────────── */
  U.bool = v => v === true || v === 1 || v === 'true';
  U.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
})();