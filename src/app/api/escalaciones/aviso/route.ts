import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { aQuienAvisar } from '@/lib/ai/aviso-escalada';
import { sendPlatformAlert } from '@/lib/admin/platform-whatsapp';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n';

/**
 * A QUÉ NÚMERO LLEGA UN CASO URGENTE, Y LA PRUEBA DE QUE LLEGA.
 *
 * El aviso por WhatsApp existía y no había forma de saber a dónde iba a caer
 * ni si el canal funcionaba: se descubría el día que hubiera un caso urgente,
 * que es el peor día para descubrirlo. Medido el 2026-08-28, 8 de 10 cuentas
 * no tenían destino y nadie lo sabía.
 *
 * GET dice el número. POST manda uno de prueba a ese mismo número.
 */
export const dynamic = 'force-dynamic';

async function destino() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const };

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return { error: 'Unauthorized' as const };

  return { admin, workspaceId, telefono: await aQuienAvisar(admin, workspaceId) };
}

export async function GET() {
  const r = await destino();
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 401 });
  return NextResponse.json({ telefono: r.telefono });
}

export async function POST() {
  const locale = await getLocale();
  const r = await destino();
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 401 });
  if (!r.telefono) {
    return NextResponse.json(
      { ok: false, error: translate(locale, 'assistant.avisoSinDestino') },
      { status: 400 },
    );
  }

  const res = await sendPlatformAlert({
    to: r.telefono,
    title: translate(locale, 'assistant.avisoPruebaTitulo'),
    body: translate(locale, 'assistant.avisoPruebaCuerpo'),
  });
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, telefono: r.telefono });
}
