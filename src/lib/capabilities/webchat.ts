import type { Capability, CapabilityContext } from './types';
import type { WebchatConfig } from '@/types';
import { getWebchatConnection, webchatConfig } from '@/lib/channels/webchat/connection-store';
import { updateWebchatSettings } from '@/lib/channels/webchat/settings';
import { WEBCHAT_DEFAULTS } from '@/lib/channels/webchat/config';
import { isWorkspaceAdmin } from '@/lib/workspaces/resolve';
import { cambio, ficha, tt } from './vistas';

const labels: Record<string, string> = {
  enabled: 'enable', agent_id: 'agent', primary_color: 'color', position: 'position',
  greeting: 'greeting', brand_name: 'brandName', avatar_url: 'avatar',
  require_email: 'requireEmail', require_contact: 'requireContact',
  allow_uploads: 'uploads', ask_rating: 'askRating', offline_message: 'offlineMessage',
  quick_replies: 'quickReplies', proactive_message: 'proactiveMessage',
  proactive_on_exit: 'proactiveExit', proactive_scroll_percent: 'proactiveScroll',
  proactive_urls: 'proactiveUrls', auto_open_seconds: 'autoOpen', allowed_domains: 'domains',
};
function fields(ctx: CapabilityContext, config: Record<string, unknown>) {
  return Object.entries(config ?? {}).filter(([key]) => key in labels).map(([key, value]) => {
    const choice = key === 'position' ? { left: 'positionLeft', right: 'positionRight' }[String(value)]
      : key === 'require_contact' ? { off: 'pedirNada', email: 'pedirCorreo', phone: 'pedirTelefono', both: 'pedirAmbos' }[String(value)] : undefined;
    const valor = choice ? tt(ctx, `webchat.${choice}`) : typeof value === 'boolean' ? tt(ctx, value ? 'common.yes' : 'common.no')
      : value == null ? '—' : Array.isArray(value) ? value.join(', ') : String(value);
    return { etiqueta: tt(ctx, `webchat.${labels[key]}`), valor };
  });
}

async function read(ctx: CapabilityContext) {
  return { ...WEBCHAT_DEFAULTS, ...webchatConfig(await getWebchatConnection(ctx.workspaceId, ctx.db)) };
}
async function configure(ctx: CapabilityContext, args: Record<string, unknown>) {
  if (ctx.actor.type === 'operator' || ctx.actor.type === 'ui') {
    if (!ctx.actor.id || !await isWorkspaceAdmin(ctx.db, ctx.actor.id, ctx.workspaceId)) throw new Error('workspace_admin_required');
  }
  if (!args.config || typeof args.config !== 'object' || Array.isArray(args.config)) throw new Error('webchat_config_required');
  const connection = await updateWebchatSettings(ctx.db, ctx.workspaceId, args.config as Partial<WebchatConfig>);
  return { ...WEBCHAT_DEFAULTS, ...webchatConfig(connection) };
}
const configProperties = {
  enabled: { type: 'boolean' }, agent_id: { type: ['string','null'] },
  primary_color: { type: 'string' }, position: { type: 'string', enum: ['left','right'] },
  greeting: { type: 'string' }, brand_name: { type: 'string' }, avatar_url: { type: 'string' },
  require_contact: { type: 'string', enum: ['off','email','phone','both'] },
  allow_uploads: { type: 'boolean' }, ask_rating: { type: 'boolean' }, offline_message: { type: 'string' },
  quick_replies: { type: 'array', items: { type: 'string' } }, proactive_message: { type: 'string' },
  proactive_on_exit: { type: 'boolean' }, proactive_scroll_percent: { type: 'number' },
  proactive_urls: { type: 'array', items: { type: 'string' } }, auto_open_seconds: { type: 'number' },
  allowed_domains: { type: 'array', items: { type: 'string' } },
};

export const WEBCHAT_CAPABILITIES: Capability[] = [
  {
    key: 'chatweb.ver', description: 'Lee la configuración actual del chat web de esta cuenta antes de proponer cambios.',
    descriptionEn: 'Read the current website chat settings for this workspace before proposing changes.',
    risk: 'lectura', schema: { type: 'object', properties: {} }, run: read,
    vista: (ctx, _args, result) => ficha({ titulo: tt(ctx,'webchat.title'), campos: fields(ctx, result as Record<string,unknown>) }),
  },
  {
    key: 'chatweb.configurar', description: 'Modifica el chat web: marca, saludo, color, agente, dominios, contacto requerido, mensajes proactivos, adjuntos y valoración. Envía sólo los ajustes que cambian. Cambiar un chat publicado requiere aprobación.',
    descriptionEn: 'Update website chat branding, greeting, color, agent, domains, required contact, proactive messages, uploads and rating. Send only changed settings. Updating a published chat requires approval.',
    risk: 'reversible', schema: { type: 'object', properties: { config: { type: 'object', properties: configProperties, additionalProperties: false } }, required: ['config'] },
    run: configure, preview: async(ctx) => tt(ctx,'operation.webchatUpdate'),
    artifact: (ctx, args) => cambio({ titulo: tt(ctx,'webchat.title'), que: tt(ctx,'operation.webchatUpdate'), campos: fields(ctx, (args.config ?? {}) as Record<string,unknown>).map(({etiqueta,valor}) => ({etiqueta,despues:valor})) }),
  },
];
