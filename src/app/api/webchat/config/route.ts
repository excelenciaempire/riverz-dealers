import { NextResponse } from 'next/server';
import type { WebchatConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { isWorkspaceAdmin, resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import {
  getWebchatConnection,
  upsertWebchatConnection,
  webchatConfig,
} from '@/lib/channels/webchat/connection-store';
import { widgetKey } from '@/lib/channels/webchat/token';
import {
  normalizeOrigin,
  porcentajeDeScroll,
  preguntasSugeridas,
  urlsDeInvitacion,
  WEBCHAT_DEFAULTS,
} from '@/lib/channels/webchat/config';
import { detectStoreDomains } from '@/lib/channels/webchat/domains';
import { publicBaseUrl } from '@/lib/base-url';

/**
 * La configuración del chat web, para el panel del comercio.
 *
 * A diferencia de las rutas del widget —públicas, sin sesión— esta es del
 * panel y va con todo: sesión, CSRF y membresía. Devuelve también la llave de
 * instalación y el fragmento de código listo para pegar, que es lo único que
 * el comercio tiene que hacer para tener el chat en su tienda.
 */

async function resolveWorkspace(): Promise<
  { workspaceId: string; userId: string } | { error: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabaseAdmin(), user.id);
  if (!workspaceId) {
    return { error: NextResponse.json({ error: 'no_workspace' }, { status: 404 }) };
  }
  return { workspaceId, userId: user.id };
}

function snippet(key: string): string {
  return `<script src="${publicBaseUrl()}/widget/v1.js" data-riverz-key="${key}" defer></script>`;
}

export async function GET() {
  const resolved = await resolveWorkspace();
  if ('error' in resolved) return resolved.error;

  const admin = supabaseAdmin();
  const connection = await getWebchatConnection(resolved.workspaceId, admin);
  const config = { ...WEBCHAT_DEFAULTS, ...webchatConfig(connection) };
  const key = widgetKey(resolved.workspaceId);

  // Los dominios de su tienda, deducidos. La pantalla los ofrece con un clic
  // en vez de pedirle que los escriba — es el único paso manual que quedaba y
  // era el que dejaba el chat instalado pero invisible.
  const suggested = await detectStoreDomains(admin, resolved.workspaceId).catch(() => []);

  // Los agentes de la cuenta, para poder elegir cuál atiende sin salir de acá.
  // Antes `agent_id` se podía guardar por API y no había forma de tocarlo: la
  // opción existía y era invisible.
  const { data: agentes } = await admin
    .from('ai_agents')
    .select('id, name, is_active')
    .eq('workspace_id', resolved.workspaceId)
    .is('deleted_at', null)
    .order('name');

  return NextResponse.json({
    config,
    key,
    snippet: snippet(key),
    suggested_domains: suggested,
    agents: agentes ?? [],
  });
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const resolved = await resolveWorkspace();
  if ('error' in resolved) return resolved.error;

  // Instalar el chat expone la marca en la tienda y decide desde qué dominios
  // se puede abrir. Es una acción de administración, como conectar cualquier
  // otro canal.
  if (!(await isWorkspaceAdmin(supabaseAdmin(), resolved.userId, resolved.workspaceId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Partial<WebchatConfig> | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const patch: WebchatConfig = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.agent_id !== undefined) patch.agent_id = body.agent_id || null;
  if (typeof body.primary_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.primary_color)) {
    patch.primary_color = body.primary_color;
  }
  if (body.position === 'left' || body.position === 'right') patch.position = body.position;
  if (typeof body.greeting === 'string') patch.greeting = body.greeting.slice(0, 300);
  if (typeof body.brand_name === 'string') patch.brand_name = body.brand_name.slice(0, 60);
  if (typeof body.avatar_url === 'string') {
    // Sólo https, o vacío. Se guardaba texto libre y se pintaba directo en un
    // `<img src>` del widget: un `javascript:` ahí es un enlace que alguien va
    // a clickear en la tienda de un tercero, y un `http://` rompe la página
    // entera por contenido mixto.
    const url = body.avatar_url.trim().slice(0, 500);
    patch.avatar_url = !url || /^https:\/\/\S+$/i.test(url) ? url : '';
  }
  if (typeof body.require_email === 'boolean') patch.require_email = body.require_email;
  if (
    body.require_contact === 'off' ||
    body.require_contact === 'email' ||
    body.require_contact === 'phone' ||
    body.require_contact === 'both'
  ) {
    patch.require_contact = body.require_contact;
    // El booleano viejo se mantiene en sincronía: hay lecturas que todavía lo
    // miran, y dejarlo desfasado haría que el widget pida el correo por un
    // lado y el panel diga que no por el otro.
    patch.require_email = body.require_contact === 'email' || body.require_contact === 'both';
  }
  if (typeof body.allow_uploads === 'boolean') patch.allow_uploads = body.allow_uploads;
  if (typeof body.ask_rating === 'boolean') patch.ask_rating = body.ask_rating;
  if (typeof body.offline_message === 'string') {
    patch.offline_message = body.offline_message.slice(0, 300);
  }
  if (body.quick_replies !== undefined) {
    patch.quick_replies = preguntasSugeridas(body.quick_replies);
  }
  if (typeof body.proactive_message === 'string') {
    patch.proactive_message = body.proactive_message.slice(0, 200);
  }
  if (typeof body.proactive_on_exit === 'boolean') {
    patch.proactive_on_exit = body.proactive_on_exit;
  }
  if (body.proactive_scroll_percent !== undefined) {
    patch.proactive_scroll_percent = porcentajeDeScroll(body.proactive_scroll_percent);
  }
  if (body.proactive_urls !== undefined) {
    patch.proactive_urls = urlsDeInvitacion(body.proactive_urls);
  }
  if (body.auto_open_seconds !== undefined) {
    // Acotado: menos de tres segundos es un pop-up encima de quien recién
    // entró, y más de dos minutos no lo ve nadie.
    const n = Math.floor(Number(body.auto_open_seconds));
    patch.auto_open_seconds =
      Number.isFinite(n) && n > 0 ? Math.min(120, Math.max(3, n)) : 0;
  }
  if (Array.isArray(body.allowed_domains)) {
    // Se normaliza al guardar y no al comparar: así el comercio ve en la lista
    // exactamente lo que el navegador va a mandar, y un dominio escrito de dos
    // formas distintas no entra dos veces.
    patch.allowed_domains = Array.from(
      new Set(body.allowed_domains.map((d) => normalizeOrigin(String(d))).filter(Boolean)),
    ).slice(0, 20);
  }

  const admin = supabaseAdmin();

  // Encender el chat sin dominios cargados lo deja instalado e invisible: el
  // widget arranca sólo en los dominios de la lista, y una lista vacía no es
  // ninguno. Antes de que eso pase, se cargan los de su propia tienda.
  //
  // Sólo al encender y sólo si no hay ninguno: el comercio que quiso vaciar la
  // lista a propósito no encuentra que se le vuelve a llenar sola.
  if (patch.enabled === true && patch.allowed_domains === undefined) {
    const actual = webchatConfig(await getWebchatConnection(resolved.workspaceId, admin));
    if ((actual.allowed_domains ?? []).length === 0) {
      const detectados = await detectStoreDomains(admin, resolved.workspaceId).catch(() => []);
      if (detectados.length > 0) patch.allowed_domains = detectados;
    }
  }

  const connection = await upsertWebchatConnection(resolved.workspaceId, patch, admin);
  const key = widgetKey(resolved.workspaceId);
  const suggested = await detectStoreDomains(admin, resolved.workspaceId).catch(() => []);

  return NextResponse.json({
    config: { ...WEBCHAT_DEFAULTS, ...webchatConfig(connection) },
    key,
    snippet: snippet(key),
    suggested_domains: suggested,
  });
}
