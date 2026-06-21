import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { decrypt } from "@/lib/channels/encryption";
import { sendTextMessage, sendTemplateMessage } from "@/lib/whatsapp/meta-api";
import { sanitizePhoneForMeta, isValidE164 } from "@/lib/whatsapp/phone-utils";
import { resolveWorkspaceIdForUser } from "@/lib/workspaces/resolve";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import type { ChannelConnection, Contact, Conversation } from "@/types";

/**
 * POST /api/conversations/start-whatsapp
 *
 * Start (or reopen) a WhatsApp conversation with any phone number from the
 * inbox. Two phases:
 *
 *  1. Resolve — body `{ phone, name? }`: finds/creates the contact +
 *     conversation and returns `{ conversation, window_open }`. The UI uses
 *     `window_open` to decide whether free text is allowed (a customer
 *     messaged within 24h) or an approved template is required (cold number,
 *     the only thing WhatsApp permits for business-initiated chats).
 *
 *  2. Send — body also carries `text` OR `template_name` (+ params): sends
 *     the message through the connected WhatsApp number, records it in the
 *     thread, and returns `{ conversation, message }`.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

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

  const limit = checkRateLimit(`start-wa:${user.id}`, RATE_LIMITS.send);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await req.json().catch(() => null)) as {
    phone?: string;
    name?: string;
    text?: string;
    template_name?: string;
    template_language?: string;
    template_params?: string[];
    template_preview?: string;
  } | null;

  const phone = sanitizePhoneForMeta(String(body?.phone ?? ""));
  if (!phone || !isValidE164(phone))
    return NextResponse.json(
      { error: translate(locale, "errWhatsapp.invalidPhoneFormat") },
      { status: 400 },
    );

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId)
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );

  // Active WhatsApp connection for this workspace.
  const { data: connRow } = await admin
    .from("channel_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("channel", "whatsapp")
    .eq("status", "connected")
    .maybeSingle();
  if (!connRow)
    return NextResponse.json(
      { error: translate(locale, "errWhatsapp.noWhatsappConnection") },
      { status: 400 },
    );
  const connection = connRow as ChannelConnection;

  // Find-or-create the contact (workspace + channel + external_id unique).
  let contact: Contact | null = null;
  const { data: existingContact } = await admin
    .from("contacts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("channel", "whatsapp")
    .eq("external_id", phone)
    .maybeSingle();
  if (existingContact) {
    contact = existingContact as Contact;
    const newName = body?.name?.trim();
    if (newName && !contact.name) {
      await admin.from("contacts").update({ name: newName }).eq("id", contact.id);
      contact.name = newName;
    }
  } else {
    const { data: created, error } = await admin
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        channel: "whatsapp",
        external_id: phone,
        phone,
        name: body?.name?.trim() || null,
      })
      .select()
      .single();
    if (error || !created)
      return NextResponse.json(
        { error: translate(locale, "errInbox.sendFailed") },
        { status: 500 },
      );
    contact = created as Contact;
  }

  // Find-or-create the open conversation for this contact on WhatsApp.
  let conversation: Conversation | null = null;
  const { data: existingConv } = await admin
    .from("conversations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("contact_id", contact.id)
    .eq("channel", "whatsapp")
    .is("deleted_at", null)
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingConv) {
    conversation = existingConv as Conversation;
  } else {
    const { data: created, error } = await admin
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        contact_id: contact.id,
        channel: "whatsapp",
        connection_id: connection.id,
        status: "open",
        last_message_at: new Date().toISOString(),
        last_sender_type: "agent",
        unread_count: 0,
      })
      .select()
      .single();
    if (error || !created)
      return NextResponse.json(
        { error: translate(locale, "errInbox.sendFailed") },
        { status: 500 },
      );
    conversation = created as Conversation;
  }

  // 24h customer-service window: open only if a customer message arrived in
  // the last 24h. A brand-new number has none → template required.
  const { data: lastCustomer } = await admin
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversation.id)
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const windowOpen = lastCustomer
    ? Date.now() - new Date(lastCustomer.created_at as string).getTime() < DAY_MS
    : false;

  const text = body?.text?.trim();
  const templateName = body?.template_name?.trim();

  // Phase 1: resolve only.
  if (!text && !templateName) {
    return NextResponse.json({ conversation, window_open: windowOpen });
  }

  // Phase 2: send. A cold number (window closed) can only get a template.
  if (text && !windowOpen) {
    return NextResponse.json(
      { error: translate(locale, "errWhatsapp.windowClosedNeedsTemplate") },
      { status: 400 },
    );
  }

  const phoneNumberId = String(
    (connection.config as Record<string, unknown> | null)?.phone_number_id ??
      connection.external_account_id ??
      "",
  );
  const encrypted = String(
    (connection.secrets as Record<string, unknown> | null)?.access_token ?? "",
  );
  if (!phoneNumberId || !encrypted)
    return NextResponse.json(
      { error: translate(locale, "errWhatsapp.noWhatsappConnection") },
      { status: 400 },
    );
  const accessToken = decrypt(encrypted);

  let messageId: string | undefined;
  let contentType: "text" | "template";
  let contentText: string | null;
  let storedTemplate: string | null = null;
  try {
    if (templateName) {
      const res = await sendTemplateMessage({
        phoneNumberId,
        accessToken,
        to: phone,
        templateName,
        language: body?.template_language || "en_US",
        params: Array.isArray(body?.template_params) ? body!.template_params : [],
      });
      messageId = res.messageId;
      contentType = "template";
      storedTemplate = templateName;
      contentText = body?.template_preview?.trim() || null;
    } else {
      const res = await sendTextMessage({
        phoneNumberId,
        accessToken,
        to: phone,
        text: text!,
      });
      messageId = res.messageId;
      contentType = "text";
      contentText = text!;
    }
  } catch (err) {
    console.error("[start-whatsapp] send failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "send failed" },
      { status: 400 },
    );
  }

  const { data: message } = await admin
    .from("messages")
    .insert({
      conversation_id: conversation.id,
      sender_type: "agent",
      content_type: contentType,
      content_text: contentText,
      template_name: storedTemplate,
      message_id: messageId,
      status: "sent",
    })
    .select()
    .single();

  await admin
    .from("conversations")
    .update({
      last_message_text: (contentText || `[${contentType}]`).slice(0, 200),
      last_message_at: new Date().toISOString(),
      last_sender_type: "agent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  return NextResponse.json({ conversation, message });
}
