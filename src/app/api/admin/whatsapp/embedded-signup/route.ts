import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { csrfGuard } from '@/lib/csrf';
import { savePlatformWhatsApp, platformWhatsAppStatus } from '@/lib/admin/platform-whatsapp';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('admin.whatsapp.signup');
const GRAPH = 'https://graph.facebook.com/v25.0';

/**
 * POST /api/admin/whatsapp/embedded-signup
 *
 * El número de Riverz se conecta por el MISMO camino que el de un comercio:
 * el registro incorporado de Meta. Pegar un token a mano funciona, pero es un
 * token que alguien tiene que ir a buscar, copiar y renovar — y el que lo hace
 * termina teniendo el secreto en el portapapeles.
 *
 * La única diferencia con la ruta de los comercios es dónde aterriza: acá va a
 * `platform_whatsapp_settings` (fila única, sin workspace) en vez de a la
 * conexión de un inquilino.
 */
export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    code?: string;
    waba_id?: string;
    phone_number_id?: string;
  } | null;
  if (!body?.code || !body.phone_number_id) {
    return NextResponse.json({ error: 'faltan code o phone_number_id' }, { status: 400 });
  }

  const appId = process.env.META_APP_ID ?? process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      { error: 'faltan META_APP_ID / META_APP_SECRET en el servidor' },
      { status: 503 },
    );
  }

  try {
    // El código del registro incorporado se canjea SIN redirect_uri.
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(body.code)}`,
    );
    if (!tokenRes.ok) {
      throw new Error(`canje falló (${tokenRes.status}): ${await tokenRes.text()}`);
    }
    const token = ((await tokenRes.json()) as { access_token?: string }).access_token;
    if (!token) throw new Error('el canje no devolvió access_token');

    // El número, para mostrarlo en el panel: es lo único que identifica la
    // conexión de un vistazo.
    let display: string | null = null;
    try {
      const meta = await fetch(
        `${GRAPH}/${body.phone_number_id}?fields=display_phone_number&access_token=${encodeURIComponent(token)}`,
      );
      if (meta.ok) {
        display = ((await meta.json()) as { display_phone_number?: string })
          .display_phone_number ?? null;
      }
    } catch {
      /* el número es cosmético: si Meta no lo da, se guarda igual */
    }

    const saved = await savePlatformWhatsApp(
      {
        phoneNumberId: body.phone_number_id,
        wabaId: body.waba_id ?? null,
        displayPhoneNumber: display,
        token,
        // Conectar no es encender: los avisos por WhatsApp se activan aparte,
        // cuando haya una plantilla Utility aprobada con la que mandarlos.
      },
      gate.actor.userId,
    );
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });

    // Igual que la carga manual: queda registrado quién conectó el número de la
    // plataforma. El token no entra en la auditoría.
    await recordAdminAction(gate.actor, request, {
      action: 'update.platform_whatsapp',
      targetType: 'platform',
      meta: {
        phone_number_id: body.phone_number_id,
        waba_id: body.waba_id ?? null,
        via: 'embedded_signup',
      },
    });

    return NextResponse.json(await platformWhatsAppStatus());
  } catch (err) {
    log.captureException(err, { phoneNumberId: body.phone_number_id });
    const message = err instanceof Error ? err.message : 'falló la conexión';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
