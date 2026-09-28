import { NextResponse } from 'next/server';
import {walletActivity} from '@/lib/wallet/activity';
import {serviceActivity} from '@/lib/wallet/service-activity';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { leerSuscripcion, usaSaldo } from '@/lib/billing/plan';
import { stripeDisponible } from '@/lib/billing/stripe';
import { createClient } from '@/lib/supabase/server';
import { costosReales } from '@/lib/wallet/costos';
import { rangoDe, summarizeMovements, movimientosDelPeriodo } from '@/lib/wallet/movimientos';
import { SUGERIDOS_CENTAVOS } from '@/lib/wallet/recarga';
import { leerBilletera } from '@/lib/wallet/saldo';
import { listarTarifas } from '@/lib/wallet/tarifas';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';

/**
 * El saldo y en qué se fue, para el panel.
 *
 * Una sola llamada devuelve las tres cosas que la pantalla necesita —cuánto
 * queda, cómo se movió en el rango y cuánto sale cada cosa— porque son una sola
 * pregunta para quien mira y partirlas en tres viajes sólo hace parpadear la
 * pantalla.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId)
    return NextResponse.json({ error: 'no_workspace' }, { status: 400 });

  const url = new URL(request.url);
  const rango = rangoDe(
    url.searchParams.get('desde'),
    url.searchParams.get('hasta')
  );
  const workspace=await admin.from('workspaces').select('timezone').eq('id',workspaceId).single();
  const movements = await movimientosDelPeriodo(admin, workspaceId, rango);

  const [billetera, datos, tarifas, sus, costos, activity, deliveredActivity] = await Promise.all([
    leerBilletera(admin, workspaceId),
    Promise.resolve(summarizeMovements(movements, rango, workspace.data?.timezone || 'UTC')),
    listarTarifas(admin),
    leerSuscripcion(admin, workspaceId),
    costosReales(admin, workspaceId, movements),
    walletActivity(admin, workspaceId, rango, movements),
    serviceActivity(admin, workspaceId, rango),
  ]);

  // La cuenta de cortesía no gasta saldo: la puerta la deja pasar siempre. Sin
  // esto el panel le avisaba que la IA dejó de responder a alguien a quien
  // nunca se le va a apagar — un susto inventado.
  const exenta = sus?.estado === 'cortesia' || !usaSaldo(sus);

  return NextResponse.json(
    {
      saldoCentavos: billetera.saldoCentavos,
      reservadoCentavos: billetera.reservadoCentavos ?? 0,
      disponibleCentavos:
        billetera.saldoCentavos - (billetera.reservadoCentavos ?? 0),
      moneda: billetera.moneda,
      bloquearSinSaldo: billetera.bloquearSinSaldo && !exenta,
      exenta,
      // A esta cuenta se le pasa el costo sin margen: la lista de tarifas de
      // abajo es referencia, no lo que se le descuenta.
      aCosto: billetera.cobrarACosto,
      // Lo que cuesta cada servicio. La cuenta que
      // paga a costo mira esto, no las tarifas: la tarifa es precio de lista y
      // a ella se le prometió lo contrario.
      // Provider identities stay in the private operational catalog, not in
      // merchant responses. Keep prices, measured usage and inclusion intact.
      costos: costos.filter(c=>c.concepto!=='comision_stripe').map(c=>({
        concepto: c.concepto, nombreEs: c.nombreEs, nombreEn: c.nombreEn,
        centavos: c.centavos, unidad: c.unidad, medido: c.medido, cobro: c.cobro,
        dentroDeEs: c.dentroDeEs, dentroDeEn: c.dentroDeEn,
      })),
      // La recarga automática, tal como la ve el comercio.
      auto: {
        tieneTarjeta: billetera.tieneTarjeta,
        marca: billetera.tarjetaMarca,
        ultimos4: billetera.tarjetaUltimos4,
        recargaCentavos: billetera.autoRecargaCentavos,
        umbralCentavos: billetera.autoUmbralCentavos,
        fallos: billetera.autoFallos,
        ultimoError: billetera.autoUltimoError,
      },
      resumen: datos,
      billedActivity: activity,
      serviceActivity: deliveredActivity,
      tarifas: tarifas
        .filter((t) => t.activo && t.concepto!=='comision_stripe')
        .map((t) => ({
          concepto: t.concepto,
          nombreEs: t.nombreEs,
          nombreEn: t.nombreEn,
          unidad: t.unidad,
          precioMilicentavos: t.precioMilicentavos,
        })),
      // Sin Stripe configurado no se ofrece un botón de recargar que no puede
      // funcionar.
      puedeRecargar: stripeDisponible() && !exenta,
      sugeridos: SUGERIDOS_CENTAVOS,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
