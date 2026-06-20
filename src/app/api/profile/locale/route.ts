import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isLocale } from "@/lib/i18n/config";

/**
 * POST /api/profile/locale
 *
 * Persists the signed-in user's UI language to profiles.locale for
 * cross-device sync. Best-effort: the cookie + localStorage already hold the
 * choice for the current device, so a failure here is non-fatal. Self-scoped
 * (RLS limits the update to the caller's own row), so no extra CSRF gate.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { locale?: string } | null;
  if (!body || !isLocale(body.locale)) {
    return NextResponse.json({ error: "invalid locale" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { error } = await supabase
    .from("profiles")
    .update({ locale: body.locale })
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
