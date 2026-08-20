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
import { normalizeOrigin, WEBCHAT_DEFAULTS } from '@/lib/channels/webchat/config';
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

  return NextResponse.json({
    config,
    key,
    snippet: snippet(key),
    suggested_domains: suggested,
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
  if (typeof body.avatar_url === 'string') patch.avatar_url = body.avatar_url.slice(0, 500);
  if (typeof body.require_email === 'boolean') patch.require_email = body.require_email;
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
