import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

/**
 * POST /api/workspaces/delete
 *
 * Soft-deletes a workspace by stamping workspaces.deleted_at = now().
 * Only the workspace owner can call this, and they must type the exact
 * workspace name as a typo-resistant guard. Real PII purge (messages,
 * contacts, files) is handled by a separate operator process.
 */
export async function POST(req: Request) {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { workspace_id?: string; confirm_name?: string }
    | null;
  if (!body?.workspace_id || !body.confirm_name) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.deleteFieldsRequired") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: ws } = await admin
    .from("workspaces")
    .select("id, name, owner_id, deleted_at")
    .eq("id", body.workspace_id)
    .maybeSingle();
  if (!ws) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.workspaceNotFound") },
      { status: 404 },
    );
  }
  if (ws.owner_id !== user.id) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.onlyOwnerCanDelete") },
      { status: 403 },
    );
  }
  if (ws.deleted_at) {
    return NextResponse.json({ ok: true, already_deleted: true });
  }
  if (body.confirm_name.trim() !== ws.name) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.nameMismatch") },
      { status: 400 },
    );
  }

  const { error } = await admin
    .from("workspaces")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", ws.id);
  if (error) {
    return serverError(
      error,
      translate(locale, "errAccount.deleteWorkspaceFailed"),
      400,
    );
  }

  return NextResponse.json({ ok: true });
}
