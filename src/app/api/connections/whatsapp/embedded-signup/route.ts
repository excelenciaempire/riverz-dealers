import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import { csrfGuard } from "@/lib/csrf";
import { refreshMessagingLimitTier } from "@/lib/whatsapp/tier-cap";
import { withAppsecretProof } from "@/lib/channels/meta-graph";
import { asegurarPlantillasBase } from "@/lib/whatsapp/plantillas-base";
import {
  upsertSingleWhatsAppConnection,
  syncLegacyWhatsAppConfig,
  WhatsAppAlreadyConnectedError,
} from "@/lib/channels/whatsapp/connect";
import { requestCoexistenceHistorySync } from "@/lib/channels/whatsapp/history-sync";
import {
  fetchWhatsAppAccountHealth,
  persistWhatsAppHealthSnapshot,
} from "@/lib/whatsapp/account-health";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

// v25.0 para COINCIDIR con la versión del SDK que emite el `code` (FB.login
// va en v25). El canje del code debe hacerse en la misma versión o superior a
// la que lo emitió; canjearlo en una versión menor falla.
const GRAPH = "https://graph.facebook.com/v25.0";

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
    //
    //    Este probe decide si el número es de COEXISTENCIA (ya vive en la app
    //    de WhatsApp Business del comercio) o un número NUEVO. La distinción es
    //    crítica: en un número de coexistencia NO se debe llamar /register —
    //    ese registro lo migra a Cloud API puro, rompe el emparejamiento con la
    //    app y mete la cuenta en revisión de Meta.
    //
    //    Antes, si el probe fallaba por cualquier motivo (error transitorio,
    //    rate-limit, Meta no devuelve is_on_biz_app), `phone` quedaba en `{}` y
    //    `Boolean(undefined)` colapsaba a coexistence=false → se llamaba
    //    /register sobre un número de coexistencia. Un solo probe fallido
    //    bastaba para romper el número. Por eso: reintento, y ante CUALQUIER
    //    duda se asume coexistencia (no registrar es seguro; registrar por
    //    error no lo es).
    type PhoneInfo = {
      display_phone_number?: string;
      verified_name?: string;
      is_on_biz_app?: boolean;
      platform_type?: string;
      quality_rating?: string;
    };
    const probePhone = async (): Promise<PhoneInfo | null> => {
      try {
        const res = await fetch(
          withAppsecretProof(
            `${GRAPH}/${body.phone_number_id}?fields=display_phone_number,verified_name,is_on_biz_app,platform_type,quality_rating&access_token=${encodeURIComponent(token)}`,
            token,
          ),
        );
        return res.ok ? ((await res.json()) as PhoneInfo) : null;
      } catch {
        return null;
      }
    };
    let phone = await probePhone();
    if (phone === null) phone = await probePhone(); // un reintento
    const probeFailed = phone === null;
    phone = phone ?? {};

    // Coexistencia = el número está en la app del comercio. `is_on_biz_app`
    // es la señal primaria; `platform_type` de coexistencia (no CLOUD_API) es
    // respaldo. Si el probe falló del todo, asumimos coexistencia para NO
    // registrar a ciegas — el flujo del front siempre entra por
    // whatsapp_business_app_onboarding, donde coexistencia es lo esperado.
    const explicitlyNewNumber =
      !probeFailed &&
      phone.is_on_biz_app === false &&
      (phone.platform_type ?? "").toUpperCase() !== "SMB_APP";
    const coexistence = !explicitlyNewNumber;
    if (probeFailed) {
      console.warn(
        `[whatsapp/embedded-signup] phone probe failed for ${body.phone_number_id}; assuming coexistence, skipping /register`,
      );
    }

    // 3. Subscribe the WABA to our app so webhooks fire. NOTA: en WhatsApp la
    //    SELECCIÓN de campos (incl. los de coexistencia: smb_message_echoes /
    //    history / smb_app_state_sync) es un ajuste de la app en el Dashboard de
    //    Meta — el endpoint subscribed_apps del WABA no acepta lista de campos.
    //    Acá solo confirmamos que la app quede suscrita y hacemos VISIBLE una
    //    falla en vez de tragárnosla (antes un fallo dejaba la conexión sin
    //    webhooks — y por ende sin sincronización app→Riverz — sin señal alguna).
    // Retry once on a transient failure (500 / rate-limit) before giving up —
    // a dropped WABA subscription silently stops ALL WhatsApp inbound AND the
    // app→Riverz echo sync, with the connection still showing green.
    let wabaSubscribed = false;
    for (let attempt = 0; attempt < 2 && !wabaSubscribed; attempt++) {
      try {
        const subRes = await fetch(
          withAppsecretProof(`${GRAPH}/${body.waba_id}/subscribed_apps`, token),
          { method: "POST", headers: { Authorization: `Bearer ${token}` } },
        );
        if (subRes.ok) {
          wabaSubscribed = true;
        } else {
          console.warn(
            `[whatsapp/embedded-signup] subscribe_apps failed (attempt ${attempt + 1}, ${subRes.status}): ${await subRes
              .text()
              .catch(() => "")}`,
          );
        }
      } catch (err) {
        console.warn(
          `[whatsapp/embedded-signup] subscribe_apps failed (attempt ${attempt + 1}):`,
          err,
        );
      }
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

    // 5b. Coexistencia: pedir ahora los contactos y el historial de la app. Meta
    //     sólo lo acepta en las 24 horas posteriores al onboarding y una sola
    //     vez; sin este pedido los chats anteriores no llegan nunca. No bloquea
    //     la conexión: el resultado queda anotado y el backfill lo reintenta.
    if (coexistence) {
      await requestCoexistenceHistorySync(admin, {
        connectionId,
        phoneNumberId: body.phone_number_id,
        token,
      });
    }

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

    // Purgar plantillas de un WABA ANTERIOR. Las plantillas viven a nivel de
    // WABA en Meta; al conectar un número nuevo (otro WABA), el catálogo del
    // anterior no debe seguir apareciendo. Borramos las de origen Meta
    // (Approved/Pending/Rejected) que no pertenezcan a este WABA; los
    // borradores locales (status 'Draft') se conservan. Las plantillas del
    // WABA nuevo entran en la próxima sincronización (estampadas con su
    // waba_id). Best-effort: un fallo aquí no debe tumbar la conexión.
    try {
      await admin
        .from("message_templates")
        .delete()
        .eq("user_id", user.id)
        .neq("status", "Draft")
        .or(`waba_id.is.null,waba_id.neq.${body.waba_id}`);
    } catch (err) {
      console.warn("[whatsapp/embedded-signup] template purge failed:", err);
    }

    // Las plantillas que el comercio va a necesitar, mandadas a aprobar ahora.
    //
    // Meta no deja escribirle a nadie fuera de las 24 horas sin una plantilla
    // aprobada, y la aprobación tarda horas. Sin esto, el comercio conecta,
    // arma el carrito abandonado, y descubre recién ahí que no puede activarlo
    // porque no hay ninguna plantilla que elegir. Mandarlas al conectar es la
    // diferencia entre esperar una tarde y esperar mientras trabaja.
    //
    // No se espera y no puede tumbar la conexión: recibir mensajes funciona
    // desde el primer segundo, y las plantillas son para después.
    void asegurarPlantillasBase(admin, {
      workspaceId: body.workspace_id,
      userId: user.id,
    })
      .then((r) => {
        if (r.creadas.length > 0 || r.fallaron.length > 0) {
          console.log("[whatsapp/embedded-signup] plantillas base:", {
            creadas: r.creadas.length,
            yaEstaban: r.yaEstaban.length,
            fallaron: r.fallaron,
          });
        }
      })
      .catch((err) =>
        console.warn("[whatsapp/embedded-signup] plantillas base fallaron:", err),
      );

    // 6. Comprobar que la cuenta PUEDA enviar antes de decir que quedó lista.
    //    Se lee después de conectar a propósito: asignar nuestra app como
    //    partner del WABA puede meter la cuenta en revisión, y ese estado solo
    //    se ve una vez terminado el signup. Nunca bloquea la conexión — la
    //    recepción funciona igual — pero el resultado viaja al front.
    //    OJO: revisión PENDING NO es "no puede enviar" (canSend sigue true);
    //    solo REJECTED / BLOCKED o un /register fallido marcan last_error.
    const health = await fetchWhatsAppAccountHealth({
      phoneNumberId: body.phone_number_id,
      wabaId: body.waba_id,
      accessToken: token,
    });

    // Persistir el snapshot sobre la conexión para el panel "Estado de
    // WhatsApp" (antes se leía una vez y se tiraba en un toast).
    await persistWhatsAppHealthSnapshot(
      admin,
      connectionId,
      health,
      phone.quality_rating,
    );

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
      review_pending: health.reviewPending,
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
