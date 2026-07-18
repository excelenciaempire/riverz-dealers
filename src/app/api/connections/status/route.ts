import { NextResponse } from "next/server";

/**
 * GET /api/connections/status
 *
 * Tells the client which OAuth providers have credentials configured.
 * Used by the Channels panel to show "Configura Meta App primero"
 * instead of letting the user click Conectar and hit a 500.
 *
 * Returns booleans only — no secrets leak.
 */
export async function GET(): Promise<Response> {
  return NextResponse.json({
    meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoft: Boolean(
      process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
    ),
    mercadolibre: Boolean(
      process.env.MERCADOLIBRE_CLIENT_ID && process.env.MERCADOLIBRE_CLIENT_SECRET,
    ),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  });
}
