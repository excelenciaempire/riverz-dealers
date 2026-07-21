import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { refreshMessagingLimitTier } from "@/lib/whatsapp/tier-cap";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import {
  upsertSingleWhatsAppConnection,
  syncLegacyWhatsAppConfig,
  WhatsAppAlreadyConnectedError,
} from "@/lib/channels/whatsapp/connect";
import { fetchWhatsAppAccountHealth } from "@/lib/whatsapp/account-health";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

const GRAPH = "https://graph.facebook.com/v22.0";

/** PIN de dos pasos para /register (solo en el alta de número nuevo).
 *  Ojo: es fijo por ahora, igual que antes. Si el comerciante ya tenía
 *  verificación en dos pasos con OTRO PIN, Meta rechaza el registro — y por eso
 *  ahora ese fallo se reporta en vez de tragarse. */
const REGISTER_PIN = "000000";

/**
 * POST /api/connections/whatsapp/embedded-signup
 *
 * Completes WhatsApp Embedded Signup (incl. the Coexistence path where
 * the customer shares their existing WhatsApp Business app). The
 * frontend launches Meta's Embedded Signup popup (FB.login with our
 * config_id); Meta returns:
 *   - an authorization `code` (via the FB.login callback)
 *   - `waba_id` + `phone_number_id` (via the WA_EMBEDDED_SIGNUP message
 *     event)
 *
 * We exchange the code for a long-lived business token, persist the
 * connection, and subscribe the WABA to our app so inbound messages
 * flow. For coexistence numbers the phone stays usable on the WhatsApp
 * Business app — Meta mirrors messages to our webhook.
 *
 * Body: { code, waba_id, phone_number_id, workspace_id }
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
      { error: translate(locale, "errInbox.notSignedIn") },
      { status: 401 },
    );

  const body = (await req.json().catch(() => null)) as
    | { code?: string; waba_id?: string; phone_number_id?: string; workspace_id?: string }
    | null;
  if (!body?.code || !body.waba_id || !body.phone_number_id || !body.workspace_id) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.embeddedSignupMissingFields") },
      { status: 400 },
    );
  }

  const admin = supabaseAdmin();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", body.workspace_id)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!membership)
    return NextResponse.json(
      { error: translate(locale, "errInbox.forbidden") },
      { status: 403 },
    );

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: translate(locale, "errInbox.metaAppNotConfigured") },
      { status: 503 },
    );
  }

  try {
    // 1. Exchange the Embedded Signup code for a business token. ES codes
    //    are exchanged without a redirect_uri.
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(body.code)}`,
    );
    if (!tokenRes.ok) {
      throw new Error(`token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    const token = tokenJson.access_token;
    if (!token) throw new Error("no access_token in exchange response");

    // 2. Read the phone number details (label + coexistence flag).
    const phoneRes = await fetch(
      withAppsecretProof(
        `${GRAPH}/${body.phone_number_id}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type&access_token=${encodeURIComponent(token)}`,
        token,
      ),
    );
    const phone = phoneRes.ok
      ? ((await phoneRes.json()) as {
          display_phone_number?: string;
          verified_name?: string;
          is_on_biz_app?: boolean;
          platform_type?: string;
        })
      : {};
    const coexistence = Boolean(phone.is_on_biz_app);

    // 3. Subscribe the WABA to our app so webhooks fire. NOTA: en WhatsApp la
    //    SELECCIÓN de campos (incl. los de coexistencia: smb_message_echoes /
    //    history / smb_app_state_sync) es un ajuste de la app en el Dashboard de
    //    Meta — el endpoint subscribed_apps del WABA no acepta lista de campos.
    //    Acá solo confirmamos que la app quede suscrita y hacemos VISIBLE una
    //    falla en vez de tragárnosla (antes un fallo dejaba la conexión sin
    //    webhooks — y por ende sin sincronización app→Riverz — sin señal alguna).
    try {
      const subRes = await fetch(
        withAppsecretProof(`${GRAPH}/${body.waba_id}/subscribed_apps`, token),
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!subRes.ok) {
        console.warn(
          `[whatsapp/embedded-signup] subscribe_apps failed (${subRes.status}): ${await subRes
            .text()
            .catch(() => "")}`,
        );
      }
    } catch (err) {
      console.warn("[whatsapp/embedded-signup] subscribe_apps failed:", err);
    }

    // 4. Register the number on Cloud API — ONLY for the new-number flow.
    //    Coexistence numbers stay registered on the merchant's phone; calling
    //    /register on them can disrupt the app pairing, so skip it entirely.
    //    El resultado SÍ se mira. Antes esto era un `try {} catch {}` vacío que
    //    no leía `res.ok` ni el cuerpo: un /register rechazado (PIN de dos
    //    pasos ya configurado por el comerciante, número no elegible) era
    //    indistinguible de un éxito y la conexión se guardaba igual como
    //    "connected". Así se fabricaban cuentas que decían estar conectadas y
    //    no podían enviar ni un mensaje.
    let registerError: string | null = null;
    if (!coexistence) {
      try {
        const regRes = await fetch(
          withAppsecretProof(`${GRAPH}/${body.phone_number_id}/register`, token),
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", pin: REGISTER_PIN }),
          },
        );
        if (!regRes.ok) {
          registerError = await regRes.text().catch(() => `HTTP ${regRes.status}`);
          console.error(
            `[whatsapp/embedded-signup] register failed (${regRes.status}): ${registerError}`,
          );
        }
      } catch (err) {
        registerError = err instanceof Error ? err.message : String(err);
        console.error("[whatsapp/embedded-signup] register threw:", registerError);
      }
    }

    // 5. Persist (or refresh) the connection — one WhatsApp per
    //    workspace; reconnecting the same number updates in place.
    const { connectionId, label } = await upsertSingleWhatsAppConnection(admin, {
      workspaceId: body.workspace_id,
      userId: user.id,
      token,
      phoneNumberId: body.phone_number_id,
      wabaId: body.waba_id,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name,
      coexistence,
      platformType: phone.platform_type,
      onboarding: coexistence ? "embedded_signup_coexistence" : "embedded_signup",
    });

    // Cache the WABA messaging-tier so bulk paths can gate sends without
    // a Meta roundtrip per message. Best-effort: errors leave the
    // cached tier alone (NULL is treated as TIER_50 downstream).
    await refreshMessagingLimitTier(admin, {
      connectionId,
      wabaId: body.waba_id,
      accessToken: token,
    });

    // Bridge to the legacy whatsapp_config table so automations / flows /
    // templates / broadcasts / agents can send through this number too.
    await syncLegacyWhatsAppConfig(admin, {
      workspaceId: body.workspace_id,
      phoneNumberId: body.phone_number_id,
      wabaId: body.waba_id,
      token,
    });

    // 6. Comprobar que la cuenta PUEDA enviar antes de decir que quedó lista.
    //    Se lee después de conectar a propósito: asignar nuestra app como
    //    partner del WABA puede meter la cuenta en revisión, y ese estado solo
    //    se ve una vez terminado el signup. Nunca bloquea la conexión — la
    //    recepción funciona igual — pero el resultado viaja al front para que
    //    el comerciante sepa que todavía no puede enviar, en vez de descubrirlo
    //    cuando su primera campaña no sale.
    const health = await fetchWhatsAppAccountHealth({
      phoneNumberId: body.phone_number_id,
      wabaId: body.waba_id,
      accessToken: token,
    });

    if (!health.canSend || registerError) {
      await admin
        .from("channel_connections")
        .update({
          last_error: registerError
            ? `register: ${registerError.slice(0, 400)}`
            : `no puede enviar (review=${health.reviewStatus ?? "?"}): ${health.blockers
                .map((b) => `${b.entity}${b.code ? ` ${b.code}` : ""} ${b.description}`)
                .join(" | ")
                .slice(0, 400)}`,
        })
        .eq("id", connectionId);
    }

    return NextResponse.json({
      ok: true,
      label,
      coexistence,
      can_send: health.canSend && !registerError,
      review_status: health.reviewStatus,
      blockers: health.blockers,
      notices: health.notices,
      register_error: registerError,
    });
  } catch (err) {
    if (err instanceof WhatsAppAlreadyConnectedError) {
      return NextResponse.json(
        {
          error: translate(locale, "errInbox.whatsappAlreadyConnected", {
            label: err.existingLabel,
          }),
        },
        { status: 409 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
