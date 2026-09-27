import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import {
  AFFILIATE_COOKIE,
  AFFILIATE_COOKIE_MAX_AGE,
  activeAffiliate,
  normalizeAffiliateCode,
} from '@/lib/affiliates/program';
import { getLocale } from '@/lib/i18n/server';
import { localizePath } from '@/lib/i18n/routes';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await context.params;
  const code = normalizeAffiliateCode(rawCode);
  const affiliate = code ? await activeAffiliate(supabaseAdmin(), code) : null;
  const locale = await getLocale();
  const target = new URL(
    affiliate
      ? `${localizePath('/crear', locale)}?ref=${encodeURIComponent(code!)}`
      : `${localizePath('/afiliados', locale)}?enlace=no-disponible`,
    request.url
  );
  const response = NextResponse.redirect(target, 302);
  if (affiliate && code) {
    response.cookies.set(AFFILIATE_COOKIE, code, {
      path: '/',
      maxAge: AFFILIATE_COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return response;
}
