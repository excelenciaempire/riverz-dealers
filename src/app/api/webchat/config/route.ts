import { updateWebchatSettings, WebchatSettingsError } from '@/lib/channels/webchat/settings';
import { getT } from '@/lib/i18n/server';
import { serverError } from '@/lib/api/errors';
import { NextResponse } from 'next/server';
import type { WebchatConfig } from '@/types';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { isWorkspaceAdmin, resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import {
  getWebchatConnection,
  webchatConfig,
} from '@/lib/channels/webchat/connection-store';
import { widgetKey } from '@/lib/channels/webchat/token';
import {
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  let connection;
  const admin = supabaseAdmin();
  try {
    connection = await updateWebchatSettings(admin, resolved.workspaceId, body);
  } catch (error) {
    if (error instanceof WebchatSettingsError) {
      return NextResponse.json({ error: (await getT())('errAccount.webchatAgentInvalid') }, { status: 400 });
    }
    return serverError(error);
  }
  const key = widgetKey(resolved.workspaceId);
  const suggested = await detectStoreDomains(admin, resolved.workspaceId).catch(() => []);

  return NextResponse.json({
    config: { ...WEBCHAT_DEFAULTS, ...webchatConfig(connection) },
    key,
    snippet: snippet(key),
    suggested_domains: suggested,
  });
}
