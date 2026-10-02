import {CallDetail} from '@/components/voice/call-detail';
import {VoiceFallbackSettings} from '@/components/voice/voice-fallback-settings';
import {WhatsAppCallingSettings} from '@/components/voice/whatsapp-calling-settings';
import {WhatsAppCallButton} from '@/components/voice/whatsapp-call-button';
import {CallWithAiButton} from '@/components/inbox/voice-call-view';
import {SmsSettings} from '@/components/settings/sms-settings';
import {SmsCaseTools} from '@/components/inbox/sms-case-tools';
import {ReviewSettings} from '@/components/settings/review-settings';
import {StoreReviewTools} from '@/components/products/store-reviews';
import {SubscriptionSettings} from '@/components/settings/subscription-settings';
import {NativeSubscriptionTools} from '@/components/inbox/subscription-case-tools';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { LocaleProvider } from '@/hooks/use-locale';
import { ThemeProvider } from '@/hooks/use-theme';
import { Sidebar } from '@/components/layout/sidebar';
import { MessageBubble } from '@/components/inbox/message-bubble';
import { ConversationCollaboration } from '@/components/inbox/conversation-collaboration';
import { TeamCapacity } from '@/components/inbox/team-capacity';
import { RuleVersions } from '@/components/ai/rule-versions';
import { DocumentSources } from '@/components/ai/document-sources';
import { PublicHelpPortal } from '@/components/help-portal/public-portal';
import { WidgetHelpCenter } from '@/components/webchat/help-center';
import { FlowMetricDetails } from '@/components/flows/metric-details';
import { OutcomeEvidence } from '@/components/dashboard/outcome-evidence';
import { ProductReturnPolicyEditor } from '@/components/returns/product-policy-editor';
import { HttpActionsCard } from '@/components/settings/http-actions-card';
import { ConversationUnderstanding } from '@/components/inbox/conversation-understanding';
import { CaseOrderActions } from '@/components/inbox/case-order-actions';
import { ReturnCaseHistory } from '@/components/returns/case-history';
import { AppInstallation } from '@/components/settings/app-installation';
import { TemplateAiDraft } from '@/components/templates/template-ai-draft';
import { CommslayerReleaseReview } from '@/components/landing/v4/commslayer-release-review';
import { MigrationPreview } from '@/components/contacts/migration-preview';
import BroadcastBuilder from '@/components/broadcasts/broadcast-builder';
import AutomationLogsPage from '@/app/(dashboard)/automatizaciones/[id]/registros/page';
import { MessageEvidence } from '@/components/inbox/message-evidence';
import { RelatedConversations } from '@/components/inbox/related-conversations';
import { SavedViews } from '@/components/inbox/saved-views';
import { BulkCaseActions } from '@/components/inbox/bulk-case-actions';
import { CaseReasonsCard } from '@/components/dashboard/case-reasons-card';
import { ToolContextPolicies } from '@/components/ai/tool-context-policies';
import { ReturnLogisticsEvidence } from '@/components/returns/logistics-evidence';
import { ids, now, selected, improved, locale, copy, report } from './fixtures';

const pages = [['inbox', 'Bandeja', 'Inbox'], ['rules', 'Reglas', 'Rules'], ['documents', 'Documentos', 'Documents'],
  ['reports', 'Reportes', 'Reports'], ['flows', 'Flujos', 'Flows'], ['returns', 'Postventa', 'After-sales'], ['connections', 'Acciones HTTP', 'HTTP actions'],
  ['orders', 'Acciones de pedidos', 'Order actions'], ['templates', 'Plantillas', 'Templates'], ['campaigns', 'Campañas', 'Campaigns'], ['automations', 'Automatizaciones', 'Automations'], ['mobile', 'Avisos móviles', 'Mobile notifications'], ['release', 'Lanzamiento', 'Launch'], ['migrations','Migraciones','Migrations'],['help','Ayuda','Help'],['voice','Llamadas','Calls'],['voice-mailbox','Buzón','Voicemail'],['voice-whatsapp','Voz por WhatsApp','WhatsApp voice'],['sms','SMS','SMS'],['reviews','Reseñas','Reviews'],['subscriptions','Suscripciones','Subscriptions']];
const automationParams = Promise.resolve({ id: ids.flow });
const noChange = () => {};
function VoiceMailboxPreview() {
  const [callId,setCallId]=React.useState(null);
  return <div className="space-y-4">
    <VoiceFallbackSettings workspaceId={ids.workspace}/>
    <button className="rounded-lg border px-3 py-2 text-xs" onClick={()=>setCallId(ids.conversation)}>{copy('Ver buzón de ejemplo','View example voicemail')}</button>
    <CallDetail callId={callId} onClose={()=>setCallId(null)}/>
  </div>;
}
function WhatsAppVoicePreview(){return <div className="space-y-4"><VoiceFallbackSettings workspaceId={ids.workspace}/>
 {improved&&<WhatsAppCallingSettings workspaceId={ids.workspace}/>}
 <section className="rounded-xl border bg-card p-4 space-y-3"><p className="text-sm">Camila · +12025550100</p>
 <CallWithAiButton workspaceId={ids.workspace} contactId={ids.product} className="w-full justify-center"/>
 {improved&&<WhatsAppCallButton workspaceId={ids.workspace} contactId={ids.product} name="Camila" phone="+12025550100"/>}</section></div>;}
const selectedCases = [ids.conversation];
function SmsPreview(){
 const [open,setOpen]=React.useState(false);
 return <div className="space-y-4 min-w-0"><p className="text-sm">Gmail · Outlook · Zoho</p><p className="text-xs text-muted-foreground">{copy('Los canales de correo actuales se conservan; esta vista muestra los controles nuevos de SMS.','Existing email channels are preserved; this view shows new SMS controls.')}</p>
 {improved&&<><ul className="list-none"><SmsSettings workspaceId={ids.workspace}/></ul><button className="rounded-lg border px-3 py-2 text-xs" onClick={()=>setOpen(true)}>{copy('Ver conversación SMS de ejemplo','View example SMS conversation')}</button>
 {open&&<section className="rounded-xl border bg-card min-w-0"><SmsCaseTools workspaceId={ids.workspace} conversationId={ids.conversation} contactId={ids.product} connectionId={ids.flow} peer="+573001234567"/></section>}</>}
 </div>;
}
const reportRange = { start: report.range.start, end: report.range.end, previous_start: '2026-08-01T00:00:00Z', previous_end: report.range.start };
const embedded = selected.get('embedded') === '1';
function url(params) { return '/?' + new URLSearchParams({ stage: improved ? 'comparison' : 'current', locale, page: selected.get('page') ?? 'inbox', ...(embedded ? { embedded: '1' } : {}), ...params }); }
function SampleThread() {
  const message = (id, content_text, sender_type) => ({ id, conversation_id: ids.conversation, channel: 'whatsapp', content_text, content_type: 'text', sender_type,
    status: sender_type === 'customer' ? 'received' : 'sent', created_at: now, media_url: null, metadata: {}, deleted_at: null });
  return <div className="space-y-3 rounded-xl border bg-card p-4">
    <h2 className="font-semibold">Camila · WhatsApp</h2>
    {improved && <SavedViews onChange={noChange} />}
    {improved && <BulkCaseActions ids={selectedCases} onApplied={noChange} />}
    <MessageBubble message={message(ids.message, copy('¿Puedo cambiar la talla de mi pedido?', 'Can I exchange the size of my order?'), 'customer')} />
    <MessageBubble message={message(ids.product, copy('Voy a revisar el pedido y el estado de despacho para preparar el cambio.', 'I will check the order and dispatch status to prepare the exchange.'), 'bot')} senderName="Riverz" />
    {improved && <MessageEvidence conversationId={ids.conversation} messageId={ids.product} />}
    {improved && <ConversationCollaboration conversationId={ids.conversation} composing={false} />}
    {improved && <RelatedConversations conversationId={ids.conversation} />}
    {improved && <ConversationUnderstanding conversationId={ids.conversation} conversation={{ id: ids.conversation, channel: 'whatsapp', status: 'open', contact_id: ids.product, workspace_id: ids.workspace }} />}
    {improved && <TeamCapacity />}
  </div>;
}
function App() {
  const page = selected.get('page') ?? 'inbox';
  const [menuOpen, setMenuOpen] = React.useState(false), [template, setTemplate] = React.useState(copy('Hola {{1}}, tenemos novedades para ti.', 'Hello {{1}}, we have news for you.'));
  return <LocaleProvider initialLocale={locale}><ThemeProvider><Toaster /><div className="flex h-screen overflow-hidden bg-background text-foreground">
    <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
    <div className="min-w-0 flex-1 overflow-y-auto">
      <header className="border-b p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3"><strong>{embedded ? copy(improved ? 'Mejoras' : 'Actual', improved ? 'Improvements' : 'Current') : copy('Comparación privada de Riverz', 'Private Riverz comparison')}</strong>
          <button type="button" className="rounded border px-3 py-1 lg:hidden" onClick={() => setMenuOpen(true)}>{copy('Menú', 'Menu')}</button>
          {!embedded && <><a className="rounded border px-3 py-1" href={url({ stage: 'current' })}>{copy('Versión actual', 'Current version')}</a>
          <a className="rounded border px-3 py-1" href={url({ stage: 'comparison' })}>{copy('Mejoras', 'Improvements')}</a>
          <a className="rounded border px-3 py-1" href={url({ locale: locale === 'es' ? 'en' : 'es' })}>{locale === 'es' ? 'English' : 'Español'}</a></>}
        </div>
        {!embedded && <><p className="text-xs text-muted-foreground">{copy('Componentes reales con datos ficticios. Las acciones de esta comparación solo afectan la memoria local. No es una sesión del negocio.',
          'Real components with fictional data. Comparison actions affect local memory only. This is not a business session.')}</p>
        <p className="text-xs text-muted-foreground">{copy('Vista de controles añadidos; no reproduce cada pantalla completa. Los envíos, modelos y operaciones de proveedores están bloqueados.',
          'Added-control preview; it does not reproduce every full screen. Sending, models and provider operations are blocked.')}</p>
        <nav className="flex flex-wrap gap-2">{pages.map(([key, es, en]) => <a key={key} className="rounded border px-2 py-1 text-xs" href={url({ page: key })}>{copy(es, en)}</a>)}</nav></>}
      </header>
      <main className="mx-auto max-w-4xl p-4 sm:p-6 space-y-5">
        <h1 className="text-xl font-semibold">{copy(improved ? 'Mejoras en su contexto' : 'La base actual se conserva', improved ? 'Improvements in context' : 'The current foundation is preserved')}</h1>
        {page === 'inbox' && <SampleThread />}
        {page === 'unavailable' && <p role="status" className="rounded border p-4 text-sm">{copy('Este módulo permanece en Riverz. El arnés privado no reproduce esta pantalla; usa las pestañas de comparación para revisar los controles añadidos.', 'This module remains in Riverz. The private harness does not reproduce this screen; use the comparison tabs to review the added controls.')}</p>}
        {page !== 'inbox' && <div className="rounded-xl border bg-card p-4 space-y-4">
          <p className="text-sm text-muted-foreground">{copy('Esta vista compara los controles añadidos. Los editores, campañas, plantillas y módulos actuales conservan su lugar.',
            'This view compares added controls. Existing editors, campaigns, templates and modules keep their place.')}</p>
          {improved && page === 'rules' && <><RuleVersions ruleId={ids.rule} onChanged={async () => {}} /><ToolContextPolicies agentId={ids.agent} /></>}
          {page === 'documents' && <DocumentSources agentId={ids.agent} />}
          {improved&&page==='help'&&<><PublicHelpPortal slug="fixture-store" initialLocale={locale}/><WidgetHelpCenter session="synthetic-widget-session" locale={locale} onExpired={noChange}/></>}
          {page === 'reports' && <><OutcomeEvidence report={report} /><CaseReasonsCard range={reportRange} /></>}
          {page === 'flows' && <FlowMetricDetails flowId={ids.flow} />}
          {page === 'returns' && <><ProductReturnPolicyEditor productId={ids.product} /><ReturnCaseHistory caseId={ids.product} /><ReturnLogisticsEvidence caseId={ids.product} onChanged={noChange} /></>}
          {page === 'connections' && <HttpActionsCard />}
          {improved && page === 'orders' && <CaseOrderActions conversationId={ids.conversation} shopifyOrderId="10001" />}
          {page === 'templates' && <div className="space-y-3"><label className="block text-sm">{copy('Contenido de la plantilla', 'Template content')}<textarea className="mt-2 w-full rounded border p-3" value={template} onChange={event => setTemplate(event.target.value)} /></label>{improved && <TemplateAiDraft language={locale} category="Marketing" onApply={setTemplate} />}</div>}
          {page === 'automations' && <React.Suspense fallback={<p>…</p>}><AutomationLogsPage params={automationParams} /></React.Suspense>}
          {page === 'campaigns' && <BroadcastBuilder />}
          {page === 'mobile' && <AppInstallation />}
          {page === 'release' && <CommslayerReleaseReview />}
          {page === 'migrations' && <MigrationPreview />}
            {page === 'voice' && <><p className="text-sm">{copy('Llamada de ejemplo en curso. Se conservan su ficha, grabación y transcripción.','Example call in progress. Its details, recording and transcript are preserved.')}</p><CallDetail callId={ids.conversation} onClose={noChange}/></>}
            {page === 'voice-mailbox' && <VoiceMailboxPreview/>}
            {page === 'voice-whatsapp' && <WhatsAppVoicePreview/>}
            {page === 'sms' && <SmsPreview/>}
            {page === 'reviews' && <><p className="text-sm">{copy('El catálogo y las reseñas de Mercado Libre se conservan. Judge.me añade un control plegado dentro de Productos.','The catalog and Mercado Libre reviews are preserved. Judge.me adds a collapsed control inside Products.')}</p>{improved&&<><ul className="list-none"><ReviewSettings workspaceId={ids.workspace}/></ul><StoreReviewTools workspaceId={ids.workspace}/></>}</>}
            {page === 'subscriptions' && <><p className="text-sm">{copy('Las herramientas actuales del pedido se conservan. Recharge añade suscripciones y cambios revisados dentro del caso.','Current order tools are preserved. Recharge adds subscriptions and reviewed changes inside the case.')}</p>{improved&&<><ul className="list-none"><SubscriptionSettings workspaceId={ids.workspace}/></ul><NativeSubscriptionTools workspaceId={ids.workspace} conversationId={ids.conversation} orderId={ids.product}/></>}</>}
        </div>}
      </main>
    </div>
  </div></ThemeProvider></LocaleProvider>;
}
createRoot(document.getElementById('root')).render(<App />);
