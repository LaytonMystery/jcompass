// supabase/functions/send-push/index.ts — OneSignal v16 API
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SITE_URL = "https://jcompass-ruddy.vercel.app";
const ICON_URL = `${SITE_URL}/favicon.ico`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { title, message, targetUserName } = await req.json();
    if (!title || !message) {
      return new Response(JSON.stringify({ ok: false, error: "missing_fields" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const APP_ID = Deno.env.get("ONESIGNAL_APP_ID");
    const API_KEY = Deno.env.get("ONESIGNAL_API_KEY");
    if (!APP_ID || !API_KEY) throw new Error("OneSignal not configured");

    // v16 base payload — targets all subscribers by default
    const body: Record<string, unknown> = {
      app_id: APP_ID,
      headings: { en: title },
      contents: { en: message },
      url: SITE_URL,

      // ── Visual + delivery ──────────────────────────────────────
      chrome_web_icon: ICON_URL,
      firefox_icon: ICON_URL,
      chrome_android_channel_id: undefined,

      // Force high-priority delivery (wakes the phone)
      priority: 10,
      android_visibility: 1,
      ios_interruption_level: "active",

      // Deep link
      data: { type: "ping", url: SITE_URL },
    };

    if (targetUserName) {
      // v16: replace include_external_user_ids with include_aliases
      body.include_aliases = { external_id: [targetUserName] };
      body.target_channel = "push";
    } else {
      // Broadcast — try multiple segment names to catch all subscribers
      body.included_segments = ["Subscribed Users", "Active Users", "Total Subscriptions"];
    }

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    if (!res.ok) console.error("OneSignal error:", result);

    return new Response(JSON.stringify({ ok: res.ok, result }),
      { status: res.ok ? 200 : 502, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("send-push exception:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});