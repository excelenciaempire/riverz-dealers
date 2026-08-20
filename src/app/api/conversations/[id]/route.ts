import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { serverError } from "@/lib/api/errors";
import { setIaConversacion } from "@/lib/inbox/conversaciones";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

/**
 * DELETE /api/conversations/:id
 *
 * Removes a conversation and all its messages from the workspace inbox.
 * Mirrors `/api/messages/:id` semantics: this is a "delete from inbox"
 * only — the upstream platform (WhatsApp, Gmail, IG, etc.) isn't
 * touched, so the contact can still send new messages and a fresh
 * conversation will be created the next time inbox-writer sees a
 * message from them.
 */
/**
 * PATCH /api/conversations/:id
 *
 * Actualiza flags de la conversación editables desde la bandeja. Hoy:
 * `ai_enabled` (prender/apagar el asistente IA en este chat — migración 082).
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  if (!id)
    return NextResponse.json(
      { error: translate(locale, "errInbox.missingIdGeneric") },
      { status: 400 },
    );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as { ai_enabled?: unknown } | null;
  if (!body || typeof body.ai_enabled !== "boolean") {
    return NextResponse.json(
      { error: translate(locale, "errInbox.aiEnabledRequired") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!conv)
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );

  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conv.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership)
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );

  // El cuerpo vive en `lib/inbox/conversaciones` porque la capa de capacidades
  // hace lo mismo desde el chat: dos copias del UPDATE serían dos formas de
  // olvidarse de limpiar el escalamiento.
  const { error } = await setIaConversacion(admin, {
    workspaceId: conv.workspace_id,
    conversationId: id,
    activa: body.ai_enabled,
  });
  if (error) return serverError(error);
  return NextResponse.json({ ok: true, ai_enabled: body.ai_enabled });
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.missingIdGeneric") },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );
  }

  const admin = supabaseAdmin();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (!conv) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.notFound") },
      { status: 404 },
    );
  }
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conv.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  // Soft-delete (migración 085): marcamos deleted_at en vez de DELETE físico.
  // Los messages se conservan, así las métricas por fecha no se vacían y el
  // polling de email no revive el hilo (el ingest deduplica por message_id).
  const { error } = await admin
    .from("conversations")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) {
    return serverError(error);
  }
  return NextResponse.json({ ok: true });
}
