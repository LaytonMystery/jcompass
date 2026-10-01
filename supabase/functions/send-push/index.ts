import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const body: Record<string, unknown> = {
      app_id: APP_ID,
      contents: { en: message },
      headings: { en: title },
      priority: 10,
      data: { type: "ping" },
    };
    if (targetUserName) body.include_external_user_ids = [targetUserName];
    else body.included_segments = ["Subscribed Users"];

    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Key ${API_KEY}` },
      body: JSON.stringify(body),
    });

    const result = await res.json();
    return new Response(JSON.stringify({ ok: res.ok, result }),
      { status: res.ok ? 200 : 502, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});