import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { persistMetaConnections, MetaConnectError } from "@/lib/channels/meta-connect";
import type { Channel } from "@/types";

// v22.0 para que coincida con la versión del SDK que emitió el code
// (FB.login usa v22.0); un code emitido en v22 fallaba al canjearlo en v21.
const GRAPH = "https://graph.facebook.com/v22.0";
const VALID_CHANNELS = ["messenger", "instagram", "fb_comment", "ig_comment"];

/**
 * POST /api/connections/meta/sdk-connect
 *
 * Completes Facebook Login for Business for Messenger / Instagram via the
 * JS SDK (FB.login with our config_id). The client gets an authorization
 * `code` from FB.login and posts it here; we exchange it for a long-lived
 * user token (FL4B codes are exchanged WITHOUT a redirect_uri), then
 * discover + persist the page / IG connections via the shared helper.
 *
 * Replaces the server-side redirect flow for Meta channels: Facebook
 * rejects config_id on the bare dialog/oauth redirect ("config_id is
 * required"), but accepts it through FB.login — same as WhatsApp ES.
 *
 * Body: { code, channel, workspace_id }
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
    | { code?: string; channel?: string; workspace_id?: string }
    | null;
  if (!body?.code || !body.channel || !body.workspace_id) {
    return NextResponse.json(
      { error: "code, channel, workspace_id required" },
      { status: 400 },
    );
  }
  if (!VALID_CHANNELS.includes(body.channel)) {
    return NextResponse.json({ error: "invalid channel" }, { status: 400 });
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
    // 1. Exchange the FB.login code for a user token.
    //    El code viene del JS SDK (FB.login), cuyo diálogo registra
    //    redirect_uri = "" (vacío). El canje DEBE mandar redirect_uri vacío
    //    e IDÉNTICO, si no Facebook responde 400 error_subcode 36008
    //    ("redirect_uri ... identical"). Omitirlo no basta: hay que enviar
    //    el parámetro presente y vacío (`&redirect_uri=`).
    const tokRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=&code=${encodeURIComponent(body.code)}`,
    );
    if (!tokRes.ok) {
      // Surface Facebook's actual reason: el body trae el error_subcode /
      // message exacto (redirect_uri, code usado, appsecret, etc.), que es
      // lo único que permite arreglar un 400 sin adivinar.
      const detail = await tokRes.text().catch(() => "");
      console.error("[meta/sdk-connect] token exchange failed:", tokRes.status, detail);
      throw new MetaConnectError(
        `token exchange failed (${tokRes.status}): ${detail.slice(0, 400)}`,
      );
    }
    const tok = (await tokRes.json()) as { access_token?: string };
    let accessToken = tok.access_token;
    if (!accessToken) throw new MetaConnectError("no access_token in exchange response");

    // 2. Swap for a long-lived token (~60d) so the derived page tokens
    //    don't expire. Non-fatal.
    try {
      const ll = await fetch(
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(accessToken)}`,
      );
      if (ll.ok) {
        const j = (await ll.json()) as { access_token?: string };
        if (j.access_token) accessToken = j.access_token;
      }
    } catch (err) {
      console.warn("[meta/sdk-connect] fb_exchange_token failed (non-fatal):", err);
    }

    // 3. Discover + persist connections (shared with the OAuth callback).
    const result = await persistMetaConnections(admin, {
      accessToken,
      channel: body.channel as Channel,
      workspaceId: body.workspace_id,
      userId: user.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof MetaConnectError ? err.message : "connection failed";
    console.error("[meta/sdk-connect] error:", err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
