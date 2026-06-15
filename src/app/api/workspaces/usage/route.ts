import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { getUsageSummary } from "@/lib/metering";

/**
 * GET /api/workspaces/usage?workspace_id=...
 *
 * Returns the current calendar month's outbound message and AI reply
 * counts for the workspace. Any member of the workspace can read it —
 * the membership check happens here against the admin client because
 * we need to call the metering helpers with service-role anyway.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspace_id");
  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspace_id required" },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const usage = await getUsageSummary(workspaceId);
  return NextResponse.json(usage);
}
