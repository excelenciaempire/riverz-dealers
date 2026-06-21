import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

/**
 * POST /api/conversations/bulk-delete
 *
 * Admin-only mass delete from the inbox. Two modes:
 *   { workspace_id, ids: string[] }       — delete those specific conversations
 *   { workspace_id, channels: string[] }  — delete EVERY conversation in the
 *                                           workspace on those channels (the
 *                                           "clear this tab" action).
 *
 * The channels mode is authoritative: it deletes server-side by scope, so it
 * also removes rows the client hadn't loaded yet (or that arrived via realtime
 * mid-select). That's what makes "Select all → Delete" actually empty the
 * inbox instead of leaving stragglers that reappear on reload.
 *
 * Messages (and reactions, comment metadata) cascade-delete via FK. The
 * upstream platform (WhatsApp/IG/Messenger/Facebook) is never touched, so the
 * contact can still write again and a fresh conversation is created.
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { workspace_id?: string; ids?: string[]; channels?: string[] }
    | null;
  const workspaceId = body?.workspace_id;
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.noWorkspace") },
      { status: 400 },
    );
  }

  // Admin of the workspace only — this can wipe the whole inbox.
  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || (membership as { role: string }).role !== "admin") {
    return NextResponse.json(
      { error: translate(locale, "errInbox.adminOnly") },
      { status: 403 },
    );
  }

  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  const channels = Array.isArray(body?.channels)
    ? body.channels.filter(Boolean)
    : [];
  if (ids.length === 0 && channels.length === 0) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.bulkDeleteNoScope") },
      { status: 400 },
    );
  }

  // Always scope to the workspace so a forged id/channel can't reach another
  // tenant's rows. ids takes precedence when both are sent.
  let query = admin
    .from("conversations")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId);
  query = ids.length > 0 ? query.in("id", ids) : query.in("channel", channels);

  const { error, count } = await query;
  if (error) return serverError(error);
  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
