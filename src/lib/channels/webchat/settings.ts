import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebchatConfig } from '@/types';
import { getWebchatConnection, upsertWebchatConnection, webchatConfig } from './connection-store';
import { normalizeOrigin, porcentajeDeScroll, preguntasSugeridas, urlsDeInvitacion } from './config';
import { detectStoreDomains } from './domains';

export class WebchatSettingsError extends Error {}

/** Shared by the settings screen and Operator; every linked resource stays in this workspace. */
export async function updateWebchatSettings(admin: SupabaseClient, workspaceId: string, body: Partial<WebchatConfig>) {
  const patch: WebchatConfig = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (body.agent_id !== undefined) {
    if (body.agent_id !== null && (typeof body.agent_id !== 'string' || !body.agent_id.trim())) throw new WebchatSettingsError('agent');
    if (body.agent_id) {
      const { data, error } = await admin.from('ai_agents').select('id').eq('id', body.agent_id).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle();
      if (error) throw error;
      if (!data) throw new WebchatSettingsError('agent');
    }
    patch.agent_id = body.agent_id;
  }
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
  if (typeof body.require_email === 'boolean') {
    patch.require_email = body.require_email;
    patch.require_contact = body.require_email ? 'email' : 'off';
  }
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

  // Encender el chat sin dominios cargados lo deja instalado e invisible: el
  // widget arranca sólo en los dominios de la lista, y una lista vacía no es
  // ninguno. Antes de que eso pase, se cargan los de su propia tienda.
  //
  // Sólo al encender y sólo si no hay ninguno: el comercio que quiso vaciar la
  // lista a propósito no encuentra que se le vuelve a llenar sola.
  if (patch.enabled === true && patch.allowed_domains === undefined) {
    const actual = webchatConfig(await getWebchatConnection(workspaceId, admin));
    if ((actual.allowed_domains ?? []).length === 0) {
      const detectados = await detectStoreDomains(admin, workspaceId).catch(() => []);
      if (detectados.length > 0) patch.allowed_domains = detectados;
    }
  }

  return upsertWebchatConnection(workspaceId, patch, admin);
}
