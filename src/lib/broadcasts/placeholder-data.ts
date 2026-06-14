import type { Broadcast } from '@/types';

/**
 * Demo broadcasts shown on /campanas y /campanas/[id] cuando todavía no
 * existe ningún envío real. IDs prefijados con "demo-" para que el resto
 * del código pueda short-circuitar fetch / delete cuando matchea.
 */
export const PLACEHOLDER_BROADCASTS: Broadcast[] = [
  {
    id: 'demo-1',
    user_id: 'demo',
    name: 'Lanzamiento serum vitamina C',
    template_name: 'lanzamiento_serum_vit_c',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'sent',
    total_recipients: 487,
    sent_count: 487,
    delivered_count: 458,
    read_count: 330,
    replied_count: 59,
    failed_count: 29,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
  {
    id: 'demo-2',
    user_id: 'demo',
    name: 'Black Friday — 25% off',
    template_name: 'black_friday_2026',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'sending',
    total_recipients: 1240,
    sent_count: 744,
    delivered_count: 699,
    read_count: 503,
    replied_count: 90,
    failed_count: 45,
    created_at: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
  {
    id: 'demo-3',
    user_id: 'demo',
    name: 'Reactivación clientes inactivos',
    template_name: 'recompra_30dias',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'scheduled',
    total_recipients: 312,
    sent_count: 0,
    delivered_count: 0,
    read_count: 0,
    replied_count: 0,
    failed_count: 0,
    scheduled_at: new Date(Date.now() + 1000 * 60 * 60 * 26).toISOString(),
    created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
  {
    id: 'demo-4',
    user_id: 'demo',
    name: 'Newsletter junio',
    template_name: 'newsletter_mensual',
    template_language: 'es',
    template_variables: {},
    audience_filter: { type: 'all' },
    status: 'draft',
    total_recipients: 0,
    sent_count: 0,
    delivered_count: 0,
    read_count: 0,
    replied_count: 0,
    failed_count: 0,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as Broadcast,
];

export function isPlaceholderBroadcastId(id: string): boolean {
  return id.startsWith('demo-');
}

export function findPlaceholderBroadcast(id: string): Broadcast | null {
  return PLACEHOLDER_BROADCASTS.find((b) => b.id === id) ?? null;
}
