import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/channels/admin-client";
import {
  checkRateLimit,
  rateLimitResponse,
  clientIp,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { safeRedirectTo } from "@/lib/auth/redirect";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";
import { authEmailConfigured, sendAuthEmail } from "@/lib/auth/email";

function defaultRecoveryRedirect() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return undefined;

  try {
    const callback = new URL("/auth/callback", siteUrl);
    callback.search = "next=/nueva-clave";
    return safeRedirectTo(callback.toString());
  } catch {
    return undefined;
  }
}

/**
 * POST /api/auth/reset-password
 *
 * Generates the password-recovery link in Supabase and sends it through
 * Resend. Rate-limited per IP and email so an attacker can't hammer the
 * provider.
 *
 * Anti-enumeration: the response shape is identical whether the email
 * exists or not, and Supabase errors are swallowed. Anyone polling the
 * endpoint sees the same "if the account exists…" line every time.
 */

export async function POST(req: Request) {
  const locale = await getLocale();
  const genericOk = {
    ok: true,
    message: translate(locale, "errAccount.resetEmailSent"),
  } as const;

  const body = (await req.json().catch(() => null)) as
    | { email?: string; redirect_to?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(genericOk);
  }

  const ip = clientIp(req);
  const ipCheck = checkRateLimit(`auth-reset:ip:${ip}`, RATE_LIMITS.auth);
  if (!ipCheck.success) return rateLimitResponse(ipCheck);
  const emailCheck = checkRateLimit(
    `auth-reset:email:${email}`,
    RATE_LIMITS.auth,
  );
  if (!emailCheck.success) return rateLimitResponse(emailCheck);

  // The browser's origin cannot be trusted here: a recovery request made
  // from localhost must still produce a link to the configured Riverz site.
  const redirectTo = safeRedirectTo(body?.redirect_to) ?? defaultRecoveryRedirect();

  // En producción Riverz entrega estos correos con Resend. En entornos donde
  // ese proveedor no está configurado, conservamos el flujo usando el correo
  // transaccional de Supabase en vez de dejar al comercio sin recuperación.
  if (!authEmailConfigured()) {
    const { error } = await supabaseAdmin().auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      console.error(
        JSON.stringify({
          scope: "auth-reset",
          event: "native_recovery_email_failed",
          code: error.code ?? "unknown",
        }),
      );
      return NextResponse.json(
        { error: translate(locale, "errAccount.emailDeliveryUnavailable") },
        { status: 503 },
      );
    }
    return NextResponse.json(genericOk);
  }

  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  // Una dirección inexistente recibe exactamente la misma respuesta que una
  // existente; no se le manda nada y no se revela si hay cuenta.
  if (error?.code === "user_not_found") return NextResponse.json(genericOk);

  if (error || !data.properties?.action_link) {
    console.error(
      JSON.stringify({
        scope: "auth-reset",
        event: "recovery_link_failed",
        code: error?.code ?? "missing_link",
      }),
    );
    return NextResponse.json(
      { error: translate(locale, "errAccount.emailDeliveryUnavailable") },
      { status: 503 },
    );
  }

  const delivery = await sendAuthEmail({
    to: email,
    actionLink: data.properties.action_link,
    locale,
    kind: "recovery",
  });
  if (!delivery.ok) {
    return NextResponse.json(
      { error: translate(locale, "errAccount.emailDeliveryUnavailable") },
      { status: 503 },
    );
  }

  return NextResponse.json(genericOk);
}
