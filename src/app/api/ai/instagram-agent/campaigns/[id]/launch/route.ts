import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import {
  launchCampaign,
  type LaunchFailure,
} from '@/lib/instagram-agent/launch-campaign';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/ai/instagram-agent/campaigns/[id]/launch
 *
 * Lanza (o retoma) una campaña: resuelve la audiencia si todavía no tiene
 * destinatarios y la marca `active`. El cron `instagram-agent` se encarga del
 * envío real de los DMs en cola.
 *
 * La lógica vive en `launchCampaign` porque el chat agéntico lanza la misma
 * campaña sin pasar por HTTP. Acá queda lo que es del transporte: la sesión y
 * la traducción del motivo de la negativa.
 */

/** Cada negativa de la librería con su texto y su código HTTP. */
const FALLOS: Record<LaunchFailure, { key: string; status: number }> = {
  not_found: { key: 'errAi.campaignNotFound', status: 404 },
  already_done: { key: 'errAi.campaignAlreadyDone', status: 400 },
  no_valid_plan: { key: 'errAi.campaignNoValidPlan', status: 400 },
  no_audience: { key: 'errAi.noInstagramContactsLaunch', status: 400 },
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
  const locale = await getLocale();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }

  // Sin workspaceId: acá el cliente lleva la sesión y RLS ya recorta por
  // cuenta. El recorte explícito es para quien llama con la llave de servicio.
  const result = await launchCampaign(supabase, id);
  if (!result.ok) {
    if (result.code === 'error') {
      return NextResponse.json(
        {
          error:
            result.message || translate(locale, 'errAi.resolveAudienceFailed'),
        },
        { status: 500 },
      );
    }
    const fallo = FALLOS[result.code];
    return NextResponse.json(
      { error: translate(locale, fallo.key) },
      { status: fallo.status },
    );
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    queued: result.queued,
  });
}
