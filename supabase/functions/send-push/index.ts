// ═══════════════════════════════════════════════════════════════════════
//  JCompass — Push via Firebase Cloud Messaging HTTP v1 API
// ═══════════════════════════════════════════════════════════════════════
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { create } from "https://deno.land/x/djwt@v3.0.1/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SITE_URL = "https://jcompass-ruddy.vercel.app";
const ICON_URL = `${SITE_URL}/favicon.ico`;

const FIREBASE_SA = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")!);

// ── Convert PEM → CryptoKey ─────────────────────────────────────────
async function pemToKey(pem: string): Promise<CryptoKey> {
  const clean = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8", binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
}

// ── Get a short-lived OAuth2 access token for FCM ───────────────────
async function getAccessToken(): Promise<string> {
  const key = await pemToKey(FIREBASE_SA.private_key);
  const now = Math.floor(Date.now() / 1000);
  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: FIREBASE_SA.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    },
    key
  );

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("OAuth failed: " + JSON.stringify(data));
  return data.access_token;
}

// ── Supabase lookups ───────────────────────────────────────────────
async function getTokenForUser(userName: string): Promise<string | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/users?name=eq.${encodeURIComponent(userName)}&select=fcm_token`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await r.json();
  return (rows && rows[0] && rows[0].fcm_token) || null;
}

async function getAllTokens(): Promise<string[]> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/users?fcm_token=not.is.null&select=fcm_token`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await r.json();
  return (rows || []).map((x: any) => x.fcm_token).filter(Boolean);
}

// ── Send one message ───────────────────────────────────────────────
async function sendToToken(accessToken: string, token: string, title: string, body: string) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_SA.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: {
              icon: ICON_URL,
              badge: ICON_URL,
              vibrate: [200, 100, 200]
            },
            fcmOptions: { link: SITE_URL }
          },
          android: {
            priority: "HIGH",
            notification: {
              sound: "default",
              channelId: "jcompass_default"
            }
          },
          data: { url: SITE_URL, type: "ping" }
        }
      })
    }
  );

  const result = await res.json();
  if (!res.ok) console.error("[FCM] send error:", result);
  return { ok: res.ok, result };
}

// ── Main handler ───────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { title, message, targetUserName } = await req.json();
    if (!title || !message) {
      return new Response(JSON.stringify({ ok: false, error: "missing_fields" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken();

    if (targetUserName) {
      const token = await getTokenForUser(targetUserName);
      if (!token) {
        return new Response(JSON.stringify({ ok: false, error: "no_token_for_user" }),
          { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
      }
      const out = await sendToToken(accessToken, token, title, message);
      return new Response(JSON.stringify({ ok: out.ok, result: out.result }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const tokens = await getAllTokens();
    if (tokens.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, total: 0 }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const results = await Promise.all(
      tokens.map(t => sendToToken(accessToken, t, title, message))
    );
    const delivered = results.filter(r => r.ok).length;
    return new Response(JSON.stringify({ ok: true, sent: delivered, total: tokens.length }),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[send-push] exception:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});