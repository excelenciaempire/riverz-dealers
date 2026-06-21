import { NextResponse } from "next/server";
import { getLocale } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n/translate";

/**
 * POST /api/waitlist  — public pre-launch lead capture.
 *
 * Body: { email: string; name?: string; website?: string }
 *   - `website` is a honeypot: bots fill it, humans never see it.
 *
 * Two best-effort sinks, neither one blocking the other:
 *   1. Durable store in the `waitlist` table (Supabase, service role).
 *      Works once migration 077 is applied; silently skipped otherwise.
 *   2. Email notification to the owner via the Resend REST API.
 *      Requires RESEND_API_KEY. Recipient = WAITLIST_NOTIFY_EMAIL
 *      (defaults to riverzoficial@gmail.com). Sender = WAITLIST_FROM
 *      (defaults to Resend's shared onboarding@resend.dev, which can only
 *      deliver to the address that owns the Resend account — i.e. the
 *      owner's own inbox, which is exactly what we want here).
 *
 * The endpoint always returns 200 {ok:true} for a valid email even if a
 * sink fails, so a transient email/DB hiccup never loses the lead from the
 * user's perspective (failures are logged for follow-up).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// In production only accept submissions coming from our own marketing
// origins. A missing Origin header (same-origin fetch, some browsers) is
// allowed; a present-but-foreign Origin is rejected.
const ALLOWED_HOSTS = new Set(["riverz.co", "www.riverz.co"]);

function originAllowed(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const oHost = new URL(origin).host;
    if (ALLOWED_HOSTS.has(oHost)) return true;
    // Allow same-origin posts too (e.g. the *.onrender.com host, or any new
    // domain the app is served from) — Origin host equals the request host.
    const host = req.headers.get("host");
    return host != null && oHost === host;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!originAllowed(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { email?: string; name?: string; website?: string }
    | null;

  // Honeypot tripped → pretend success and drop silently.
  if (body?.website) return NextResponse.json({ ok: true });

  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email) || email.length > 254) {
    const locale = await getLocale();
    return NextResponse.json(
      { error: translate(locale, "errAccount.emailInvalid") },
      { status: 400 },
    );
  }
  const name = body?.name?.trim().slice(0, 120) || null;

  // 1) Durable store (best-effort; table may not exist until 077 is applied).
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(url, key);
      const { error } = await admin
        .from("waitlist")
        .upsert({ email, name, source: "landing" }, { onConflict: "email", ignoreDuplicates: true });
      if (error) {
        console.warn(JSON.stringify({ scope: "waitlist", msg: "store_failed", error: error.message }));
      }
    }
  } catch (e) {
    console.warn(
      JSON.stringify({ scope: "waitlist", msg: "store_error", error: e instanceof Error ? e.message : String(e) }),
    );
  }

  // 2) Notify the owner by email (best-effort).
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.WAITLIST_NOTIFY_EMAIL || "riverzoficial@gmail.com";
  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.WAITLIST_FROM || "Riverz <onboarding@resend.dev>",
          to: [to],
          reply_to: email,
          subject: `Nuevo lead en la lista de espera · ${email}`,
          html:
            `<h2 style="font-family:system-ui">Nuevo lead</h2>` +
            `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
            (name ? `<p><strong>Nombre:</strong> ${escapeHtml(name)}</p>` : "") +
            `<p style="color:#666"><strong>Fecha:</strong> ${new Date().toISOString()}</p>`,
        }),
      });
      if (!res.ok) {
        console.warn(JSON.stringify({ scope: "waitlist", msg: "email_failed", status: res.status, email }));
      }
    } catch (e) {
      console.warn(
        JSON.stringify({ scope: "waitlist", msg: "email_error", error: e instanceof Error ? e.message : String(e) }),
      );
    }
  } else {
    // No email provider configured yet — still record the lead in the log.
    console.log(JSON.stringify({ scope: "waitlist", msg: "lead_no_email_provider", email, name }));
  }

  return NextResponse.json({ ok: true });
}
