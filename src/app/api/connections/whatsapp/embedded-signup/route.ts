import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { encrypt } from "@/lib/channels/encryption";
import { refreshMessagingLimitTier } from "@/lib/whatsapp/tier-cap";

const GRAPH = "https://graph.facebook.com/v22.0";

/**
 * POST /api/connections/whatsapp/embedded-signup
 *
 * Completes WhatsApp Embedded Signup (incl. the Coexistence path where
 * the customer shares their existing WhatsApp Business app). The
 * frontend launches Meta's Embedded Signup popup (FB.login with our
 * config_id); Meta returns:
 *   - an authorization `code` (via the FB.login callback)
 *   - `waba_id` + `phone_number_id` (via the WA_EMBEDDED_SIGNUP message
 *     event)
 *
 * We exchange the code for a long-lived business token, persist the
 * connection, and subscribe the WABA to our app so inbound messages
 * flow. For coexistence numbers the phone stays usable on the WhatsApp
 * Business app — Meta mirrors messages to our webhook.
 *
 * Body: { code, waba_id, phone_number_id, workspace_id }
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { code?: string; waba_id?: string; phone_number_id?: string; workspace_id?: string }
    | null;
  if (!body?.code || !body.waba_id || !body.phone_number_id || !body.workspace_id) {
    return NextResponse.json(
      { error: "code, waba_id, phone_number_id, workspace_id required" },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", body.workspace_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json({ error: "Meta app not configured" }, { status: 503 });
  }

  try {
    // 1. Exchange the Embedded Signup code for a business token. ES codes
    //    are exchanged without a redirect_uri.
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(body.code)}`,
    );
    if (!tokenRes.ok) {
      throw new Error(`token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const token = tokenJson.access_token;
    if (!token) throw new Error("no access_token in exchange response");

    // 2. Read the phone number details (label + coexistence flag).
    const phoneRes = await fetch(
      `${GRAPH}/${body.phone_number_id}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type&access_token=${encodeURIComponent(token)}`,
    );
    const phone = phoneRes.ok
      ? ((await phoneRes.json()) as {
          display_phone_number?: string;
          verified_name?: string;
          is_on_biz_app?: boolean;
        })
      : {};

    const label = phone.verified_name
      ? `${phone.verified_name} (${phone.display_phone_number ?? ""})`.trim()
      : `WhatsApp ${body.phone_number_id}`;

    // 3. Subscribe the WABA to our app so webhooks fire.
    try {
      await fetch(`${GRAPH}/${body.waba_id}/subscribed_apps`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.warn("[whatsapp/embedded-signup] subscribe_apps failed:", err);
    }

    // 4. Register the number on Cloud API (non-coexistence flow). For
    //    coexistence (is_on_biz_app) Meta handles activation, so a 4xx
    //    here is non-fatal.
    try {
      await fetch(`${GRAPH}/${body.phone_number_id}/register`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin: "000000" }),
      });
    } catch {
      // best-effort
    }

    // 5. Persist (or refresh) the connection.
    const payload = {
      workspace_id: body.workspace_id,
      channel: "whatsapp" as const,
      label,
      status: "connected" as const,
      external_account_id: body.phone_number_id,
      config: {
        phone_number_id: body.phone_number_id,
        waba_id: body.waba_id,
        display_phone_number: phone.display_phone_number,
        verified_name: phone.verified_name,
        coexistence: Boolean(phone.is_on_biz_app),
        onboarding: "embedded_signup",
      },
      secrets: { access_token: encrypt(token) },
      created_by: user.id,
    };
    const { error: insErr, data: inserted } = await admin
      .from("channel_connections")
      .insert(payload)
      .select("id")
      .single();
    let connectionId = (inserted?.id as string | undefined) ?? null;
    if (insErr) {
      if (insErr.code === "23505") {
        const { data: existing } = await admin
          .from("channel_connections")
          .update({
            secrets: payload.secrets,
            config: payload.config,
            label,
            status: "connected",
            last_error: null,
          })
          .eq("workspace_id", body.workspace_id)
          .eq("channel", "whatsapp")
          .eq("external_account_id", body.phone_number_id)
          .select("id")
          .maybeSingle();
        connectionId = (existing?.id as string | undefined) ?? null;
      } else {
        throw new Error(`insert failed: ${insErr.message}`);
      }
    }

    // Cache the WABA messaging-tier so bulk paths can gate sends without
    // a Meta roundtrip per message. Best-effort: errors leave the
    // cached tier alone (NULL is treated as TIER_50 downstream).
    if (connectionId) {
      await refreshMessagingLimitTier(admin, {
        connectionId,
        wabaId: body.waba_id,
        accessToken: token,
      });
    }

    return NextResponse.json({ ok: true, label, coexistence: Boolean(phone.is_on_biz_app) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
