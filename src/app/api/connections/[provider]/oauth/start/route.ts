import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { baseUrl, encodeState, loadProvider, type ProviderName } from "@/lib/channels/oauth";

const VALID: ProviderName[] = ["meta", "google", "microsoft"];

/**
 * GET /api/connections/:provider/oauth/start?workspace_id=…&channel=…
 *
 * Generates a signed `state` token and redirects the browser to the
 * provider's authorize endpoint. The callback (see ./callback) verifies
 * the same state and persists the resulting credentials in
 * `channel_connections`.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");
  const channel = url.searchParams.get("channel");
  if (!workspaceId || !channel) {
    return NextResponse.json({ error: "workspace_id + channel required" }, { status: 400 });
  }

  // Admin-only.
  const { data: membership } = await supabaseAdmin()
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  let cfg;
  try {
    cfg = loadProvider(provider);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provider not configured" },
      { status: 500 },
    );
  }

  const state = encodeState({ workspaceId, channel });
  const redirectUri = `${baseUrl(req)}/api/connections/${provider}/oauth/callback`;
  const authorize = new URL(cfg.authorizationUrl);
  authorize.searchParams.set("client_id", cfg.clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", cfg.scopes.join(provider === "google" ? " " : ","));
  authorize.searchParams.set("state", state);
  for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) {
    authorize.searchParams.set(k, v);
  }
  return NextResponse.redirect(authorize.toString());
}

function isProvider(p: string): p is ProviderName {
  return (VALID as string[]).includes(p);
}
