import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { ingestRawMedia, MAX_ATTACHMENT_BYTES } from "@/lib/channels/media-ingest";
import { toSendableImage, renameForMime } from "@/lib/whatsapp/image-compat";
import type { Conversation } from "@/types";
import { limitedFormData, PayloadTooLargeError } from "@/lib/security/limited-form-data";

/**
 * POST /api/messages/upload  (multipart/form-data)
 *
 * Uploads a composer attachment (image/video/audio/document) to Supabase
 * Storage and returns an authenticated media URL + metadata. The client then calls
 * /api/messages/send with that media payload. Kept separate from the send
 * route so the (potentially large) file body never mixes with the JSON send.
 *
 * Fields: file (Blob), conversation_id (string).
 */
export async function POST(req: Request): Promise<Response> {
  const block = await csrfGuard(req);
  if (block) return block;
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: translate(locale, "errInbox.unauthorized") },
      { status: 401 },
    );

  let form: FormData;
  try {
    form = await limitedFormData(req, MAX_ATTACHMENT_BYTES + 8 * 1024);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json(
        { error: translate(locale, "errInbox.uploadTooLarge") },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { error: translate(locale, "errInbox.uploadInvalid") },
      { status: 400 },
    );
  }
  const file = form.get("file");
  const conversationId = String(form.get("conversation_id") ?? "");
  if (!(file instanceof Blob) || !conversationId) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.uploadInvalid") },
      { status: 400 },
    );
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.uploadTooLarge") },
      { status: 413 },
    );
  }

  const admin = supabaseAdmin();
  const { data: conversation } = await admin
    .from("conversations")
    .select("id, workspace_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.conversationNotFound") },
      { status: 404 },
    );
  }
  const workspaceId = (conversation as Conversation).workspace_id;
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );
  }

  const raw = Buffer.from(await file.arrayBuffer());
  let fileName = "name" in file ? String((file as File).name || "") : "";
  // WhatsApp solo entrega JPEG/PNG: un WebP/HEIC llega a Meta pero falla en la
  // entrega con 131053. Se convierte acá, así lo que se guarda, lo que se ve en
  // el hilo y lo que recibe el cliente son el mismo archivo.
  const safe = await toSendableImage(raw, file.type || "application/octet-stream");
  const buffer = safe.buffer;
  const mime = safe.mime;
  if (safe.converted) fileName = renameForMime(fileName, safe.mime) ?? fileName;
  const ingested = await ingestRawMedia({
    buffer,
    mime,
    workspaceId,
    conversationId,
    id: randomUUID(),
    fileName: fileName || undefined,
  });
  if (!ingested) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.uploadFailed") },
      { status: 502 },
    );
  }

  return NextResponse.json({
    url: ingested.url,
    mime: ingested.mediaMime,
    mediaType: ingested.mediaType,
    name: fileName || undefined,
    size: ingested.mediaSize,
  });
}
