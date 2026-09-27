import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { getLocale } from '@/lib/i18n/server';
import { emptyResponse, leerAtribucion } from '@/lib/attribution/informe';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analytics/attribution
 *
 * Qué ventas son de Riverz y cuáles sólo pasaron cerca. El cálculo entero vive
 * en `lib/attribution/informe`, que es lo que llama también el Operador cuando
 * le preguntan cuánto vendió Riverz: dos implementaciones del mismo número
 * serían dos cifras, y en ésta eso es lo peor que puede pasar.
 *
 * Acá queda lo que es de una ruta: sesión, parámetros y resolver el workspace.
 */
export async function GET(request: Request) {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  // Date-range filter: prefer explicit ISO start/end (from the dashboard's
  // global filter); fall back to the legacy ?days= window. `until` lets a
  // custom/past range exclude orders after the picked end day.
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  let sinceIso: string;
  let untilIso: string;
  let days: number;
  if (
    startParam &&
    endParam &&
    !Number.isNaN(Date.parse(startParam)) &&
    !Number.isNaN(Date.parse(endParam))
  ) {
    sinceIso = new Date(startParam).toISOString();
    untilIso = new Date(endParam).toISOString();
    // Defensive: never let an inverted range silently return zero orders.
    if (Date.parse(sinceIso) > Date.parse(untilIso)) {
      [sinceIso, untilIso] = [untilIso, sinceIso];
    }
    days = Math.max(1, Math.round((Date.parse(untilIso) - Date.parse(sinceIso)) / 86_400_000));
  } else {
    days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? '30')));
    sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
    untilIso = new Date().toISOString();
  }

  // Ventana de last-touch: cuántas horas antes del pedido cuenta un envío
  // como el que lo causó. 24h es el default histórico y sirve para una
  // campaña o un carrito abandonado, donde la compra cae el mismo día.
  // Una recuperación de pago rechazado no: la persona tiene que hablar con
  // el banco o esperar a que le entre plata, y vuelve a los dos o tres
  // días. Con 24h fijas esas ventas quedaban sin atribuir. Es un parámetro
  // y no un cambio de default para no inflar de golpe los números
  // históricos de campañas y flujos.
  const attrHours = Math.max(
    1,
    Math.min(720, Number(url.searchParams.get('attr_hours') ?? '24')),
  );
  const lookbackMs = attrHours * 3_600_000;

  const admin = supabaseAdmin();

  // Resolver el workspace del caller EXACTAMENTE como lo resuelve el resto de
  // la app (instalación, productos, status): owner-first vía
  // resolveWorkspaceIdForUser. Antes este endpoint usaba `workspace_members`
  // ordenado por joined_at, que difería del id bajo el que se guarda la
  // conexión de Shopify — y reportaba "no conectado" en un shop conectado.
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) {
    return NextResponse.json(emptyResponse(days));
  }

  const informe = await leerAtribucion(admin, {
    workspaceId,
    sinceIso,
    untilIso,
    days,
    lookbackMs,
    locale,
  });
  return NextResponse.json(informe,{headers:{'Cache-Control':'no-store'}});
}
