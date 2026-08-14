import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { countryOfPhone } from '@/lib/whatsapp/phone-utils';

/**
 * Qué recetas de la galería tienen sentido para ESTE comercio.
 *
 * Nace de la recuperación de pagos rechazados: Mercado Pago sólo opera en
 * Latinoamérica, así que ofrecerle esa receta a una tienda de Estados
 * Unidos es ruido permanente — nunca va a poder conectarlo. Pero esconderla
 * a quien no lo tiene conectado todavía mata el descubrimiento: nadie
 * conecta una pasarela por una función que no sabe que existe.
 *
 * La salida del medio es mostrarla cuando hay señal de que le sirve:
 * ya la conectó, o el comercio opera donde esa pasarela existe.
 *
 * La región se deduce de dos cosas que el comercio ya declaró: la moneda de
 * su tienda y el país de su número de WhatsApp. Ninguna de las dos se le
 * pregunta: si vende en pesos argentinos, ya está dicho.
 */

/** Monedas donde Mercado Pago opera. */
const LATAM_CURRENCIES = new Set([
  'ARS', 'BRL', 'MXN', 'COP', 'CLP', 'PEN', 'UYU',
]);

/** Países donde Mercado Pago opera. */
const LATAM_COUNTRIES = new Set([
  'AR', 'BR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC', 'BO', 'PY', 'VE',
]);

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });
  }

  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId) {
    // Sin workspace no hay contexto: se devuelve el caso conservador
    // (nada conectado, sin región) en vez de un error que rompa la galería.
    return NextResponse.json({
      payments: { mercadopago: false },
      currency: null,
      latam: false,
    });
  }

  // Lectura con service role: `shopify_connections.currency` no está
  // otorgada a `authenticated` (migración 078/129), y no vale la pena
  // abrirla sólo para esto.
  const admin = supabaseAdmin();

  const [{ data: integration }, { data: shop }, { data: conn }] = await Promise.all([
    admin
      .from('workspace_integrations')
      .select('is_active')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'mercadopago')
      .maybeSingle(),
    admin
      .from('shopify_connections')
      .select('currency')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    admin
      .from('channel_connections')
      .select('config')
      .eq('workspace_id', workspaceId)
      .eq('channel', 'whatsapp')
      .limit(1)
      .maybeSingle(),
  ]);

  const currency = (shop as { currency?: string | null } | null)?.currency ?? null;
  const phone = (conn as { config?: { display_phone_number?: string } } | null)
    ?.config?.display_phone_number;
  const country = countryOfPhone(phone);

  const latam =
    (currency ? LATAM_CURRENCIES.has(currency.toUpperCase()) : false) ||
    (country ? LATAM_COUNTRIES.has(country) : false);

  return NextResponse.json({
    payments: {
      mercadopago: Boolean((integration as { is_active?: boolean } | null)?.is_active),
    },
    currency,
    country,
    latam,
  });
}
