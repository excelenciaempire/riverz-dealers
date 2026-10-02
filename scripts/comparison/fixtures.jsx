import React from 'react';
import { LOCALE_STORAGE_KEY } from '@/lib/i18n/config';
export const ids = { workspace: '10000000-0000-4000-8000-000000000001', user: '10000000-0000-4000-8000-000000000002',
  conversation: '10000000-0000-4000-8000-000000000003', rule: '10000000-0000-4000-8000-000000000004',
  agent: '10000000-0000-4000-8000-000000000005', product: '10000000-0000-4000-8000-000000000006',
  message: '10000000-0000-4000-8000-000000000007', flow: '10000000-0000-4000-8000-000000000008' };
export const now = '2026-10-01T14:00:00Z';
export const selected = new URLSearchParams(location.search);
export const improved = selected.get('stage') === 'comparison';
export const locale = selected.get('locale') === 'en' ? 'en' : 'es';
document.documentElement.lang = locale;
try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Private preview may block storage. */ }
export const copy = (es, en) => locale === 'en' ? en : es;
export const report = { range: { start: '2026-09-01T00:00:00Z', end: now }, attended: 1, verified: 1, rate: 1, toReview: 0,
  human: 0, pending: [], trial: null, breakdown: { tracking: 1, product: 0, confirmation: 0, address: 0, return: 0, other: 0 },
  cases: [{ id: ids.conversation, name: null, channel: 'whatsapp', at: now, lastMessageId: ids.message, state: 'verified',
    category: 'tracking', firstCustomerAt: '2026-10-01T13:40:00Z', verifiedAt: now, verificationSeconds: 1200 }],
  verificationTiming: { samples: 1, unavailable: 0, medianSeconds: 1200, basis: 'first_customer_to_current_team_review' } };
const team = { user_id: ids.user, is_admin: true, teams: [{ id: ids.agent, name: 'Riverz', enabled: true, member_ids: [ids.user] }],
  members: [{ id: ids.user, name: 'Camila', available: true, enabled: true, capacity: 15, active: 3 }] };
const collaboration = { user_id: ids.user, notes: [{ id: ids.rule, body: copy('Cliente solicita cambiar talla antes del despacho.', 'Customer requests a size change before dispatch.'),
  author_id: ids.user, author_name: 'Camila', created_at: now, mentioned_user_ids: [] }], members: [{ id: ids.user, name: 'Camila' }],
  presence: [{ id: ids.user, name: 'Camila', composing: false }], case: { case_priority: 'normal', case_reason: 'return' }, next_cursor: null };
const source = { id: ids.product, name: copy('Cambios y devoluciones.docx', 'Returns and exchanges.docx'), format: 'docx', bytes: 2048,
  sha256: 'a'.repeat(64), text: copy('Los cambios requieren revisar el producto y su fecha de entrega. Los reembolsos requieren aprobación.',
    'Exchanges require reviewing the product and delivery date. Refunds require approval.'), status: 'active', revision: 1, updated_at: now };
const rule = { id: ids.rule, titulo: copy('Cambio de talla', 'Size exchange'), cuando: copy('El cliente pide otra talla.', 'The customer requests another size.'),
  hacer: copy('Verificar pedido y despacho; preparar la propuesta para revisión.', 'Check the order and dispatch; prepare a proposal for review.'), live_revision: 1, activa: true };
let ruleDraft = null;
const ruleVersions = [{ rule_id: ids.rule, revision: 1, snapshot: { ...rule }, created_at: now, source: 'baseline', actor_id: ids.user }];
const documentHistory = [{ ...source, observed_at: now }];
const caseAnswer = { gap_id: ids.flow, question: copy('¿Podemos reservar la talla M para este pedido?', 'Can we reserve size M for this order?'), missing: null,
  created_at: now, answer: copy('Reserva autorizada solo para este caso durante 24 horas; confirmar existencias antes del cambio.', 'Reservation authorized only for this case for 24 hours; confirm stock before the exchange.'), revision: 1, answered_at: now, answered_by: ids.user, resolved_at: null };
let policySnapshot = { product_id: ids.product, revision: 1, changed_at: now, policy: { mode: 'allow', window_days: 15, starts_at: 'delivery',
  remedies: ['exchange', 'replacement'], conditions: copy('Revisar que el producto no tenga uso.', 'Check that the product is unused.') } };
function reply(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
/** The browser fetch is replaced before any product component mounts. No credentials or server calls. */
export async function fixtureFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
  if (url.origin !== location.origin) return reply({ error: 'comparison_external_request_blocked' }, 403);
  const path = url.pathname;
  window.__comparisonCalls ??= []; window.__comparisonCalls.push({ path, method: init.method ?? 'GET' });
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  const method = init.method ?? 'GET';
  const editable = path.endsWith('/collaboration') || path.endsWith('/documents') && method === 'PATCH' || path.endsWith('/versions') || path.endsWith('/return-policy');
  if (method !== 'GET' && !editable) return reply({ error: copy('Operación bloqueada en la comparación local.', 'Operation blocked in the local comparison.') }, 503);
  if (path.endsWith('/collaboration')) {
    if (body.action === 'case') collaboration.case = { case_priority: body.priority, case_reason: body.reason };
    if (body.action === 'note') collaboration.notes.unshift({ id: body.id, body: body.body, author_id: ids.user, author_name: 'Camila', created_at: now, mentioned_user_ids: body.mentions });
    return reply(collaboration);
  }
  if (path === '/api/inbox/team') return reply(team);
  if (path === '/api/inbox/filters') return reply({ user_id: ids.user, members: team.members, filters: [{ id: ids.flow, name: copy('Cambios de talla', 'Size exchanges'), config: { case_reason: 'return' }, is_shared: true, user_id: ids.user, count: 1, supported: true }] });
  if (path.endsWith('/actions')) return reply({ snoozed_until: null, reminders: [], history: [] });
  if (path.endsWith('/related')) return reply({ candidates: [], links: [] });
  if (path.endsWith('/knowledge-answers')) return reply({ questions: [caseAnswer], notices: {}, truncated: false, whatsapp_enabled: false });
  if (path.endsWith('/knowledge-answers/source')) return reply({ scope: 'case_only', source: { id: ids.flow, question_snapshot: caseAnswer.question, answer: caseAnswer.answer, revision: caseAnswer.revision, created_at: now, actor_id: ids.user } });
  if (path.endsWith('/rule-reviews')) return reply({ turn_id: ids.message, rule_id: ids.rule, rule_revision: 1,
    rule: { titulo: rule.titulo, cuando: rule.cuando, hacer: rule.hacer }, review: null, history: [], history_truncated: false, can_edit: true, attribution: 'team_assessment' });
  if (path.endsWith('/evidence')) return reply({ receipts: [{ id: ids.message, status: 'sent', reason: null, created_at: now,
    evidence: { version: 1, rules: [{ id: ids.rule, revision: 1, title: rule.titulo }],
      sources: [{ kind: 'message', id: ids.message }, { kind: 'document', id: source.id, title: source.name, revision: 1 }, { kind: 'case_answer', id: ids.flow, title: caseAnswer.question }],
      tools: [{ name: 'lookup_order', kind: 'local', status: 'returned', sequence: 1 }], truncated: false } }], legacy: [], truncated: false });
  if (path.endsWith('/native-block')) return reply({ available: false, error: copy('El bloqueo del proveedor no se consulta en la comparación privada.', 'Provider blocking is not queried in the private comparison.') });
  if (path.includes('/macros')) return reply({ macros: [], tags: [] });
  if (path === '/api/tags') return reply({ tags: [] });
  if (path.endsWith('/documents')) {
    if (method === 'PATCH') {
      if (body.source_id !== source.id || body.revision !== source.revision) return reply({ error: copy('La versión cambió.', 'The revision changed.') }, 409);
      if (body.action === 'edit') { source.text = body.text; source.status = 'draft'; }
      else source.status = body.action === 'activate' ? 'active' : 'withdrawn';
      source.revision++;documentHistory.unshift({ ...source, observed_at: now });return reply(source);
    }
    if (url.searchParams.has('source_id')) return reply({ history: documentHistory });
    return reply({ sources: [source], can_edit: true });
  }
  if (path.includes('/drive')) return reply({ connected: false, email: null, sources: [] });
  if (path.endsWith('/tool-contexts')) return reply({ revision: 1, policy: {}, can_edit: true, history: [], truncated: false });
  if (path === '/api/analytics/case-reasons') {
    const selectedReason = url.searchParams.get('reason');
    return reply({ ...Object.fromEntries(['start', 'end', 'previous_start', 'previous_end'].map(key => [key, url.searchParams.get(key)])), observed_at: now,
      rows: ['purchase', 'delivery', 'payment', 'return', 'other', 'unclassified'].map(reason => ({ reason, current_count: reason === 'return' ? 1 : 0, previous_count: 0, rated_count: 0, positive_count: 0 })),
      selected_reason: selectedReason, cases: selectedReason ? [{ id: ids.conversation, channel: 'whatsapp', created_at: now, reason: selectedReason, csat: null }] : null, next_cursor: null });
  }
  if (path.endsWith('/versions')) {
    if (method !== 'GET') {
      if (body.action === 'save') ruleDraft = { rule_id: ids.rule, workspace_id: ids.workspace, base_revision: rule.live_revision,
        draft_revision: (ruleDraft?.draft_revision ?? 0) + 1, state: 'draft', snapshot: body.snapshot, updated_by: ids.user, updated_at: now };
      if (body.action === 'discard') ruleDraft = null;
      if (body.action === 'publish' && ruleDraft) { Object.assign(rule, ruleDraft.snapshot);rule.live_revision++;ruleDraft = null;ruleVersions.unshift({ rule_id: ids.rule, revision: rule.live_revision, snapshot: { ...rule }, created_at: now, source: 'comercio', actor_id: ids.user }); }
    }
    return reply({ rule, draft: ruleDraft, versions: ruleVersions, next_before: null, is_admin: true });
  }
  if (path.endsWith('/activity')) return reply({ from_at: report.range.start, through_at: now, recorded_turns: 2, distinct_cases: 1, failed_turns: 0, approval_turns: 1 });
  if (path.endsWith('/reviews')) return reply({ attribution: 'team_assessment', reviewed_turns: 1,
    applied_turns: 1, missed_turns: 0, not_applicable_turns: 0, unverified_turns: 0, eligible_turns: 1, related_transfer_turns: 0, assessed_transfer_turns: 0,
    distinct_reviewed_cases: 1, application_rate: 100 });
  if (path.endsWith('/test')) return reply({ cases: [{ id: ids.conversation, name: 'Camila', channel: 'whatsapp', last_message_at: now }] });
  if (path.endsWith('/node-analytics')) {
    const from = url.searchParams.get('from') ?? new Date(Date.parse(now) - Number(url.searchParams.get('days') ?? 7) * 86400000).toISOString();
    const through = url.searchParams.get('through') ?? now;
    const records = [{ id: ids.product, conversation_id: ids.conversation, status: 'completed', started_at: '2026-10-01T13:00:00Z', ended_at: now },
      { id: ids.agent, conversation_id: ids.conversation, status: 'active', started_at: '2026-10-01T13:10:00Z', ended_at: null }]
      .filter(row => (!url.searchParams.get('status') || row.status === url.searchParams.get('status')) && (url.searchParams.get('node_key') !== 'review' || row.status === 'completed'));
    return reply({ flow_id: ids.flow, from_at: from, through_at: through, days: url.searchParams.has('from') ? null : Number(url.searchParams.get('days') ?? 7),
      attribution: 'recorded_execution', total_runs: 2, node_entries: 3, by_node: { welcome: 2, review: 1 }, by_status: { completed: 1, active: 1 },
      evidence_filter: { node_key: url.searchParams.get('node_key'), status: url.searchParams.get('status') }, matched_runs: records.length, records, next_cursor: null });
  }
  if (path.endsWith('/return-policy')) {
    if (method === 'POST') { policySnapshot = { ...policySnapshot, policy: body.policy, revision: policySnapshot.revision + 1 };return reply(policySnapshot); }
    return reply({ snapshot: policySnapshot, can_edit: true });
  }
  if (path.endsWith('/historial')) return reply({ events: [{ id: ids.rule, event_sequence: 1, event_type: 'opened', occurred_at: now, actor_id: ids.user,
    status: 'abierta', previous_status: null, resolution: copy('Solicitud ilustrativa; aún no hay recepción ni reembolso confirmado.', 'Illustrative request; no receipt or refund has been confirmed yet.'), previous_resolution: null, photo_count: 0 }], next_cursor: null });
  if (path.endsWith('/logistica')) return reply({ case_id: ids.product, status: 'aprobada', updated_at: now, platform: null, events: [], next_cursor: null });
  if (path.endsWith('/orders')) return reply({ orders: [{ id: ids.product, shopify_order_id: '10001' }], history: [], locks: [], actors: {}, can_execute: true });
  if (path.endsWith('/customer-address-requests')) return reply({ requests: [] });
  if (path === '/api/pwa/notifications') return reply({ enabled: false, public_key: null });
  if (path === '/api/whatsapp/templates/draft-context') return reply({ products: [{ id: ids.product, label: copy('Camiseta · COP 45.000', 'T-shirt · COP 45,000') }], agents: [{ id: ids.agent, label: 'Riverz' }], has_more: false });
  if (path.startsWith('/api/automations/') && path.endsWith('/logs')) return reply({ workspace_id: ids.workspace, automation: { id: ids.flow, name: copy('Seguimiento de pedido', 'Order follow-up') }, linked_log: null, next_cursor: null,
    logs: [{ id: ids.rule, automation_id: ids.flow, contact_id: ids.product, contact: { id: ids.product, name: 'Camila' }, status: 'success', created_at: now,
      trigger_event: 'order_created', steps_executed: [{ step_id: 'wait', step_type: 'wait', status: 'success', detail: copy('Espera completada', 'Wait completed') }], error_message: null }] });
  if (path === '/api/integrations/http-actions') return reply({ actions: [] });
  return reply({ error: 'comparison_fixture_not_configured' }, 503);
}
window.fetch = fixtureFetch;
window.open = () => null;
document.addEventListener('click', event => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (anchor && new URL(anchor.href, location.origin).origin !== location.origin) event.preventDefault();
}, true);
export const useFetchWithCsrf = () => fixtureFetch;
export const SHOW_RIVERZ_IMPROVEMENTS = improved;
export const useWorkspace = () => ({ workspace: { id: ids.workspace, owner_id: ids.user, name: 'Riverz Demo' },
  membership: { user_id: ids.user, role: 'admin', allowed_sections: null }, isAdmin: true, loading: false, memberships: [] });
export const useAuth = () => ({ user: { id: ids.user, email: 'demo@example.invalid' }, profile: { full_name: 'Camila', email: 'demo@example.invalid', avatar_url: null }, signOut: async () => {} });
export const useTotalUnread = () => 2;
export const useTimezone = () => 'America/Bogota';
export const useSaldo = () => ({ saldo: null });
export const useFeatureFlags = () => ({ flags: {}, isPlatformAdmin: false, loading: false });
export const useRiverz2 = () => true;
export const usePathname = () => ({ inbox: '/bandeja', rules: '/asistente', documents: '/asistente', reports: '/panel', flows: '/menus', returns: '/productos', connections: '/integraciones', orders: '/pedidos', templates: '/plantillas', campaigns: '/campanas', automations: '/automatizaciones', mobile: '/ajustes' }[selected.get('page') ?? 'inbox'] ?? '/bandeja');
export const useSearchParams = () => new URLSearchParams();
export const useRouter = () => ({ push: navigate, replace: navigate, refresh() {}, back() {} });
function navigate(path) {
  const page = path.startsWith('/asistente') ? 'rules' : path.startsWith('/panel') ? 'reports' : path.startsWith('/menus') ? 'flows' : path.startsWith('/productos') ? 'returns' : path.startsWith('/integraciones') ? 'connections' : path.startsWith('/pedidos') ? 'orders' : path.startsWith('/plantillas') ? 'templates' : path.startsWith('/campanas') ? 'campaigns' : path.startsWith('/automatizaciones') ? 'automations' : path.startsWith('/ajustes') ? 'mobile' : path.startsWith('/bandeja') ? 'inbox' : 'unavailable';
  // This isolated static harness has no Next router; stay on its own origin.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.href = `/?${new URLSearchParams({ stage: improved ? 'comparison' : 'current', locale, page, ...(selected.get('embedded') === '1' ? { embedded: '1' } : {}) })}`;
}
export const redirect = navigate;
export const useLocalizedRouter = useRouter;
const fixtureTables = {
  message_templates: [{ id: ids.rule, workspace_id: ids.workspace, name: 'riverz_example', status: 'Approved', language: locale,
    category: 'Marketing', body_text: copy('Hola {{1}}, conoce las novedades de nuestra tienda.', 'Hello {{1}}, discover what is new in our store.'), header_type: 'text', header_content: '', buttons: [], variable_samples: ['Camila'], variable_fields: { '1': 'customer_name' }, created_at: now }],
  tags: [], custom_fields: [], contact_segments: [], contact_tags: [],
  contacts: [{ id: ids.product, workspace_id: ids.workspace, name: 'Camila', phone: '+000000000', email: 'demo@example.invalid', opted_out: false }],
  channel_connections: [{ id: ids.agent, workspace_id: ids.workspace, channel: 'whatsapp', status: 'connected', config: { waba_id: 'fictional', phone_number_id: 'fictional' } }],
};
/** No Supabase SDK or credentials. All DB writes are refused by this fixture. */
export function createClient() {
  return { auth: { getUser: async () => ({ data: { user: { id: ids.user } }, error: null }) }, from(table) {
    let data = [...(fixtureTables[table] ?? [])], write = false, single = false;
    let proxy;
    const query = { then(resolve, reject) { return Promise.resolve(write ? { data: null, error: { message: copy('Operación bloqueada en la comparación local.', 'Operation blocked in the local comparison.') } } : { data: single ? data[0] ?? null : data, error: null, count: data.length }).then(resolve, reject); } };
    proxy = new Proxy(query, { get(target, key) {
      if (key === 'then') return target.then;
      return (...args) => {
        if (['insert', 'update', 'delete', 'upsert'].includes(key)) write = true;
        if (key === 'eq' || key === 'is') data = data.filter(row => row[args[0]] === args[1]);
        if (key === 'in') data = data.filter(row => args[1].includes(row[args[0]]));
        if (key === 'limit') data = data.slice(0, args[0]);
        if (key === 'range') data = data.slice(args[0], args[1] + 1);
        if (key === 'single' || key === 'maybeSingle') single = true;
        return proxy;
      };
    } });return proxy;
  } };
}
export const useBroadcastSending = () => ({ isProcessing: false, createAndSendBroadcast: async () => { throw new Error(copy('Envío bloqueado en la comparación local.', 'Sending blocked in the local comparison.')); } });
export default function LocalLink({ children, src, href, alt = '', ...props }) {
  const attributes = { ...props };delete attributes.prefetch;delete attributes.priority;delete attributes.fill;
  // eslint-disable-next-line @next/next/no-img-element -- Static local assets; no optimizer or provider request in the harness.
  if (src) return <img src={src} alt={alt} {...attributes} />;
  return <a {...attributes} href={href} onClick={event => { event.preventDefault(); if (typeof href === 'string' && href.startsWith('/')) navigate(href); }}>{children}</a>;
}
