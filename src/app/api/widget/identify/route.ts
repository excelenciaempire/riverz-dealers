import { NextResponse } from 'next/server';
import type { Contact } from '@/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { requireSession } from '@/lib/channels/webchat/guard';
import { getLogger } from '@/lib/log/logger';

const log = getLogger('widget.identify');

/**
 * POST /api/widget/identify — ponerle nombre al visitante.
 *
 * Quien entra al chat es anónimo: un id que guardó su navegador. Cuando dice
 * su correo —porque el comercio se lo pide antes de escribir, porque el agente
 * se lo pregunta para buscar un pedido, o porque compra— deja de serlo, y ahí
 * este contacto tiene que dejar de ser un desconocido más para convertirse en
 * el cliente que el comercio ya conocía por WhatsApp o por Shopify.
 *
 * Lo que NO hace: fusionarlo con el cliente que el comercio ya conocía. Acá el
 * correo es una AFIRMACIÓN de alguien anónimo, y fusionar sobre eso permitía
 * quedarse con la ficha de otra persona —sus pedidos incluidos— escribiendo su
 * correo en un chat. Esa unión ocurre cuando la identidad está PROBADA: al
 * comprar, con los datos que la tienda efectivamente cobró.
 *
 * Sólo agrega. Un dato que el visitante escribe no pisa el que el comercio ya
 * tenía: un nombre mal tipeado en un chat no puede renombrar a un cliente.
 */
export async function POST(request: Request) {
  const guard = await requireSession(request, 'identify');
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    name?: unknown;
    phone?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Sólo texto. Un campo que llega como número o como lista no tiene `.trim()`
  // y tumbaba la ruta con un 500; acá se descarta y se sigue con los que sí
  // sirven, porque identificarse a medias es mejor que no identificarse.
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const email = str(body.email).trim().toLowerCase().slice(0, 200);
  const name = str(body.name).trim().slice(0, 120);
  const phone = str(body.phone).trim().slice(0, 32);
  // Un correo de verdad, sin comodines. `%` y `_` son comodines de `ilike`, y
  // el correo termina en una búsqueda de contactos: con `%@%.%` una sola
  // llamada matcheaba a TODOS los del comercio.
  if (email && !/^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }
  if (!email && !name && !phone) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data } = await admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', session.workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', session.visitorId)
    .maybeSingle();
  const contact = data as Contact | null;
  if (!contact) {
    // Todavía no escribió nada. No se crea el contacto acá: un visitante que
    // sólo abrió el widget no es una fila en la base de nadie.
    return NextResponse.json({ ok: true, linked: false });
  }

  // `afirmado` (migracion 206): lo escribio alguien anonimo en un chat y nadie
  // lo verifico. Se guarda -- sirve para escribirle -- pero NO une. Si manana
  // ese mismo correo aparece en un pedido, ahi si.
  const patch: Record<string, string> = {};
  if (email && !contact.email) {
    patch.email = email;
    patch.email_origen = 'afirmado';
  }
  if (name && !contact.name) patch.name = name;
  if (phone && !contact.phone) {
    patch.phone = phone;
    patch.phone_origen = 'afirmado';
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, linked: false });
  }

  const { error } = await admin.from('contacts').update(patch).eq('id', contact.id);
  if (error) {
    log.captureException(error, { workspaceId: session.workspaceId });
    return NextResponse.json({ error: 'update_failed' }, { status: 502 });
  }

  // A propósito NO se fusiona con otros contactos.
  //
  // Acá el dato es una AFIRMACIÓN de alguien anónimo: escribió un correo en un
  // chat, nadie lo verificó. Fusionar sobre eso era una toma de cuenta en dos
  // pasos — poner el correo de otra clienta y quedarse con su ficha, sus
  // pedidos y la posibilidad de pedir que se los reembolsen. El agente lee
  // mensajes de desconocidos: acá esa frase deja de ser teórica.
  //
  // La fusión sigue existiendo donde la identidad está PROBADA: cuando la
  // persona compra de verdad, `attributeWebchatOrder` une el visitante con el
  // cliente usando los datos que Shopify cobró. Ahí no hay nada que afirmar.
  return NextResponse.json({ ok: true, linked: false });
}
