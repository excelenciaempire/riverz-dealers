import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { decrypt, encrypt } from "@/lib/channels/encryption";
import { registrarNumero } from "@/lib/channels/whatsapp/registro";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

/**
 * POST /api/connections/whatsapp/register  { connection_id, pin }
 *
 * Registra en Cloud API un número propio que quedó sin registrar porque ya
 * tenía verificación en dos pasos con un PIN del comercio. Sin esto, la única
 * salida era desconectar y volver a conectar, y fallaba igual.
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
    return NextResponse.json({ error: translate(locale, "errInbox.notSignedIn") }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { connection_id?: string; pin?: string } | null;
  const pin = String(body?.pin ?? "").trim();
  if (!body?.connection_id || !/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: translate(locale, "errInbox.whatsappPinInvalido") }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: conn } = await admin
    .from("channel_connections")
    .select("id, workspace_id, external_account_id, secrets, config")
    .eq("id", body.connection_id)
    .eq("channel", "whatsapp")
    .maybeSingle();
  if (!conn) {
    return NextResponse.json({ error: translate(locale, "errInbox.forbidden") }, { status: 404 });
  }
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", conn.workspace_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: translate(locale, "errInbox.forbidden") }, { status: 403 });
  }

  const secrets = (conn.secrets ?? {}) as Record<string, unknown>;
  const token = typeof secrets.access_token === "string" ? decrypt(secrets.access_token) : null;
  const phoneNumberId = String(
    ((conn.config ?? {}) as Record<string, unknown>).phone_number_id ?? conn.external_account_id ?? "",
  );
  if (!token || !phoneNumberId) {
    return NextResponse.json({ error: translate(locale, "errInbox.whatsappPinFallo") }, { status: 400 });
  }

  const reg = await registrarNumero({ phoneNumberId, token, pin });
  if (!reg.ok) {
    return NextResponse.json(
      {
        error: translate(
          locale,
          reg.pinDistinto ? "errInbox.whatsappPinDistinto" : "errInbox.whatsappPinFallo",
        ),
      },
      { status: 400 },
    );
  }

  await admin
    .from("channel_connections")
    .update({
      secrets: { ...secrets, register_pin: encrypt(pin) },
      last_error: null,
      status: "connected",
    })
    .eq("id", conn.id);

  return NextResponse.json({ ok: true });
}
