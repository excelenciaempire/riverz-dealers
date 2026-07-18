import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encodeState } from "@/lib/channels/oauth";

/**
 * GET /api/tiktok/oauth/start?workspace_id=…
 *
 * Kicks off the TikTok ACCOUNT HOLDER authorization (Accounts API, scope
 * "TikTok Accounts"). TikTok generates the app-specific authorization URL in
 * its portal (My Apps → Basic Information → "TikTok account holder
 * authorization URL") — set it as TIKTOK_ACCOUNT_AUTH_URL. We append our
 * signed `state` for CSRF; TikTok echoes it back on the registered redirect
 * (/api/tiktok/oauth/callback — dedicated path because that exact URL was
 * registered in the app under review).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if ((member as { role?: string } | null)?.role !== "admin") {
    return NextResponse.json({ error: "admin required" }, { status: 403 });
  }

  const authUrl = process.env.TIKTOK_ACCOUNT_AUTH_URL;
  if (!authUrl) {
    return NextResponse.json({ error: "TIKTOK_ACCOUNT_AUTH_URL not configured" }, { status: 501 });
  }
  const state = encodeState({ workspaceId, channel: "tiktok_comment" });
  const sep = authUrl.includes("?") ? "&" : "?";
  return NextResponse.redirect(`${authUrl}${sep}state=${encodeURIComponent(state)}`);
}
