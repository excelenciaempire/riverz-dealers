import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { csrfGuard } from '@/lib/csrf';
import { savePlatformWhatsApp, platformWhatsAppStatus } from '@/lib/admin/platform-whatsapp';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('admin.whatsapp.signup');
const GRAPH = 'https://graph.facebook.com/v25.0';

/** PIN de dos pasos para /register. El mismo que usa el alta de un comercio. */
const REGISTER_PIN = '000000';

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

    // El número, y de paso si ya vive en la app de WhatsApp Business: eso
    // decide si se puede registrar más abajo.
    type PhoneInfo = {
      display_phone_number?: string;
      is_on_biz_app?: boolean;
      platform_type?: string;
    };
    let phone: PhoneInfo = {};
    let probeFailed = true;
    try {
      const meta = await fetch(
        `${GRAPH}/${body.phone_number_id}?fields=display_phone_number,is_on_biz_app,platform_type&access_token=${encodeURIComponent(token)}`,
      );
      if (meta.ok) {
        phone = (await meta.json()) as PhoneInfo;
        probeFailed = false;
      }
    } catch {
      /* el número es cosmético: si Meta no lo da, se guarda igual */
    }
    const display = phone.display_phone_number ?? null;

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

    // Guardar el token no alcanza. Un número recién dado de alta queda sin
    // registrar y TODO envío falla con `(#133010) Account not registered`; el
    // WABA sin suscribir no recibe webhooks, así que las respuestas SI/NO de
    // las aprobaciones no vuelven nunca. El alta de un comercio ya hacía las
    // dos cosas — acá faltaban, y el síntoma era el peor: el panel en verde,
    // con número y token, sin entregar un solo aviso.
    //
    // Mismo cuidado que allá: sobre un número de COEXISTENCIA, /register lo
    // migra a Cloud API puro y rompe el emparejamiento con la app. Ante
    // cualquier duda —incluido un sondeo fallido— no se registra.
    const warnings: string[] = [];
    const numeroNuevo =
      !probeFailed &&
      phone.is_on_biz_app === false &&
      (phone.platform_type ?? '').toUpperCase() !== 'SMB_APP';

    if (numeroNuevo) {
      const reg = await fetch(`${GRAPH}/${body.phone_number_id}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin: REGISTER_PIN }),
      });
      if (!reg.ok) {
        const detalle = await reg.text();
        warnings.push('el número quedó sin registrar: no va a poder enviar');
        log.warn('falló /register del número de plataforma', {
          phoneNumberId: body.phone_number_id,
          detalle: detalle.slice(0, 300),
        });
      }
    } else if (probeFailed) {
      warnings.push('no se pudo verificar el número: se omitió el registro');
    }

    if (body.waba_id) {
      const sub = await fetch(`${GRAPH}/${body.waba_id}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!sub.ok) {
        warnings.push('el WABA quedó sin suscribir: no van a llegar respuestas');
        log.warn('falló subscribed_apps del WABA de plataforma', {
          wabaId: body.waba_id,
          detalle: (await sub.text()).slice(0, 300),
        });
      }
    }

    // Igual que la carga manual: queda registrado quién conectó el número de la
    // plataforma. El token no entra en la auditoría.
    await recordAdminAction(gate.actor, request, {
      action: 'update.platform_whatsapp',
      targetType: 'platform',
      meta: {
        phone_number_id: body.phone_number_id,
        waba_id: body.waba_id ?? null,
        via: 'embedded_signup',
        registrado: numeroNuevo && warnings.length === 0,
      },
    });

    return NextResponse.json({ ...(await platformWhatsAppStatus()), warnings });
  } catch (err) {
    log.captureException(err, { phoneNumberId: body.phone_number_id });
    const message = err instanceof Error ? err.message : 'falló la conexión';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
