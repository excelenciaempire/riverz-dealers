import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import type { HttpActionDefinition } from './http-action-contract';

export const HTTP_ACTION_STARTERS = ['n8n-lookup', 'n8n-request', 'make-request', 'custom-lookup'] as const;
export type HttpActionStarter = typeof HTTP_ACTION_STARTERS[number];
export const httpActionStarters = (): readonly HttpActionStarter[] => SHOW_RIVERZ_IMPROVEMENTS ? HTTP_ACTION_STARTERS : [];
export const httpActionStarterDocs = (id: HttpActionStarter) => id === 'make-request' ? 'https://apps.make.com/gateway'
  : id.startsWith('n8n-') ? 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/' : null;

/** An editable, incomplete draft only. No destination/secret, action ID, activation, grant or provider effects. */
export function httpActionStarterDraft(id: unknown, locale: 'es' | 'en'): HttpActionDefinition | null {
  if (!SHOW_RIVERZ_IMPROVEMENTS || !HTTP_ACTION_STARTERS.includes(id as HttpActionStarter)) return null;
  const request = id === 'n8n-request' || id === 'make-request', make = id === 'make-request';
  const provider = make ? 'Make' : id === 'custom-lookup' ? (locale === 'en' ? 'own system' : 'sistema propio') : 'n8n';
  return { name: locale === 'en' ? `${request ? 'Request' : 'Lookup'} — ${provider}` : `${request ? 'Solicitud' : 'Consulta'} — ${provider}`,
    description: locale === 'en' ? (request ? 'Register a customer request after human review.' : 'Read an authorized reference belonging to this customer.')
      : (request ? 'Registrar una solicitud del cliente después de revisión humana.' : 'Consultar una referencia autorizada que pertenezca a este cliente.'),
    url: '', method: request ? 'POST' : 'GET', credential_kind: 'api-key',
    ...(make ? { api_key_header: 'x-make-apikey' as const } : {}),
    parameters: [{ key: 'contact_id', source: 'contact_id', type: 'string', required: true },
      ...(request ? [{ key: 'conversation_id', source: 'conversation_id' as const, type: 'string' as const, required: true }] : []),
      { key: request ? 'request' : 'reference', source: 'input', type: 'string', required: true }],
    outputs: [{ key: 'status', path: ['status'], type: 'string', required: true },
      { key: request ? 'request_id' : 'reference', path: [request ? 'request_id' : 'reference'], type: 'string', required: false }] };
}
