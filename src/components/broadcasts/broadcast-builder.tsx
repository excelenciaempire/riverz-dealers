'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocalizedRouter } from '@/hooks/use-localized-router';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, CalendarClock, Loader2, Plus, Send } from 'lucide-react';
import type { CustomField, MessageTemplate, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useBroadcastSending } from '@/hooks/use-broadcast-sending';
import { WhatsappPreview } from '@/components/templates/whatsapp-preview';
import type {
  TemplateButtonInput,
  TemplateHeaderType,
} from '@/lib/whatsapp/template-components';
import type { ContactSegment } from '@/lib/segments/types';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT, useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { TFn } from '@/lib/i18n/translate';
import { useWorkspace } from '@/hooks/use-workspace';
import { VoiceNoteEditor } from '@/components/voice/voice-note-editor';
import { validVoiceConfig, type VoiceNoteConfig } from '@/lib/voice-notes/types';
import { resolveSegment } from '@/lib/segments/resolve';
import { fetchAllRows } from '@/lib/supabase/paginate';
import { SegmentEditor } from '@/components/contacts/segments-panel';
import { estimateFromSample, rateFor, toCategory } from '@/lib/whatsapp/pricing';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { draftTemplateProof, type DraftConfig } from '@/lib/broadcasts/draft';

type AudienceType = 'all' | 'tags' | 'segment';
class CampaignDraftError extends Error {}
async function draftResponse(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new CampaignDraftError(fallback);
  if (!response.ok) throw new CampaignDraftError(typeof data.error === 'string' ? data.error : fallback);
  return data;
}

// Labels are i18n keys resolved with t() at render time.
const AUDIENCE_LABELS: Record<AudienceType, string> = {
  all: 'broadcasts.audienceAllLabel',
  tags: 'broadcasts.audienceByTags',
  segment: 'broadcasts.audienceBySegment',
};

// `label` is an i18n key resolved with t() at render time.
const BUILTIN_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'broadcasts.fieldFixedValue' },
  { value: 'name', label: 'broadcasts.fieldFullName' },
  { value: 'first_name', label: 'broadcasts.fieldFirstName' },
  { value: 'last_name', label: 'broadcasts.fieldLastName' },
  { value: 'phone', label: 'broadcasts.fieldPhone' },
  { value: 'email', label: 'broadcasts.fieldEmailShort' },
  { value: 'company', label: 'broadcasts.fieldCompany' },
  // Datos dinámicos de Shopify (de contacts.shopify_customer_data; se
  // resuelven por destinatario al momento del envío).
  { value: 'shopify_orders_count', label: 'broadcasts.fieldShopifyOrders' },
  { value: 'shopify_total_spent', label: 'broadcasts.fieldShopifyTotalSpent' },
  { value: 'shopify_last_order', label: 'broadcasts.fieldShopifyLastOrder' },
  { value: 'shopify_city', label: 'broadcasts.fieldShopifyCity' },
];

/** Quick chips above the manual datetime picker. Keeps the common case
 *  ("Programar para mañana 9 am") one click away. `label` is an i18n key
 *  resolved with t() at render time; `id` is the stable sentinel used by
 *  applyPreset (so the "tomorrow 9am" special-case survives translation). */
const SCHEDULE_PRESETS: { id: string; label: string; minutesAhead: number }[] = [
  { id: 'in1h', label: 'broadcasts.presetIn1Hour', minutesAhead: 60 },
  { id: 'in3h', label: 'broadcasts.presetIn3Hours', minutesAhead: 180 },
  { id: 'tomorrow9', label: 'broadcasts.presetTomorrow9am', minutesAhead: -1 }, // sentinel; computed below
  { id: 'in1w', label: 'broadcasts.presetIn1Week', minutesAhead: 60 * 24 * 7 },
];

function formatLocalDateTimeInput(d: Date) {
  // datetime-local expects "YYYY-MM-DDTHH:mm" in *local* time, no Z.
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function applyPreset(preset: (typeof SCHEDULE_PRESETS)[number], now: Date) {
  if (preset.id === 'tomorrow9') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const d = new Date(now.getTime() + preset.minutesAhead * 60_000);
  d.setSeconds(0, 0);
  return d;
}

function describeScheduledAt(iso: string | null, t: TFn): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs <= 0) return t('broadcasts.rightNow');
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60)
    return t(mins === 1 ? 'broadcasts.inMinute' : 'broadcasts.inMinutes', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24)
    return t(hours === 1 ? 'broadcasts.inHour' : 'broadcasts.inHours', { n: hours });
  const days = Math.round(hours / 24);
  return t(days === 1 ? 'broadcasts.inDay' : 'broadcasts.inDays', { n: days });
}

export default function BroadcastBuilder({ draftId }: { draftId?: string }) {
  const router = useLocalizedRouter();
  const t = useT();
  const { locale } = useLocale();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const { createAndSendBroadcast, isProcessing } = useBroadcastSending();
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id;

  const [name, setName] = useState('');
  const [audienceType, setAudienceType] = useState<AudienceType>('all');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [segmentId, setSegmentId] = useState<string>('');
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>('');
  const [voiceNote, setVoiceNote] = useState<VoiceNoteConfig | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [variableMapping, setVariableMapping] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [createConversations, setCreateConversations] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  // A sample of recipient phone numbers, used to price the campaign by
  // (country, template category) per Meta's rate card.
  const [samplePhones, setSamplePhones] = useState<string[]>([]);
  const [showSegmentModal, setShowSegmentModal] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [draftLoading, setDraftLoading] = useState(Boolean(draftId));
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  const [draftWorkspace, setDraftWorkspace] = useState<string | null>(null);
  const [originalSchedule, setOriginalSchedule] = useState<string | null>(null);
  const [loadedTemplate, setLoadedTemplate] = useState<MessageTemplate | null>(null);
  const [excludedTagIds, setExcludedTagIds] = useState<string[]>([]);
  const [editBusy, setEditBusy] = useState(false);
  const [review, setReview] = useState<{ updated_at: string; total_recipients: number; estimated_cost: number | null } | null>(null);

  useEffect(() => {
    if (!draftId || !workspaceId) return;
    const controller = new AbortController();
    setDraftLoading(true); setDraftError(null); setReview(null); setDraftVersion(null);
    void fetch(`/api/broadcasts/draft?id=${encodeURIComponent(draftId)}`, { credentials: 'same-origin', signal: controller.signal })
      .then(async res => {
        const data = await draftResponse(res, 'broadcast_draft_unavailable');
        if (controller.signal.aborted) return;
        const config = data.config as DraftConfig;
        setName(config.name); setAudienceType(config.audience_filter.type);
        setSelectedTagIds(config.audience_filter.tagIds ?? []); setSegmentId(config.audience_filter.segmentId ?? '');
        setExcludedTagIds(config.audience_filter.excludeTagIds ?? []);
        setVoiceNote(config.voice_note); setLoadedTemplate(data.template); setTemplateId(data.template?.id ?? '');
        setVariables(Object.fromEntries(Object.entries(config.variables).map(([key, v]) => [key, v.type === 'static' ? v.value : ''])));
        setVariableMapping(Object.fromEntries(Object.entries(config.variables).filter(([, v]) => v.type !== 'static').map(([key, v]) => [key, v.value])));
        setScheduledAt(config.scheduled_at ? formatLocalDateTimeInput(new Date(config.scheduled_at)) : '');
        setOriginalSchedule(config.scheduled_at);
        setSendMode(config.scheduled_at ? 'schedule' : 'now'); setCreateConversations(config.create_conversations);
        setDraftVersion(data.updated_at); setDraftWorkspace(workspaceId);
      }).catch(error => { if (!controller.signal.aborted) setDraftError(error instanceof CampaignDraftError ? error.message : 'broadcast_draft_unavailable'); })
      .finally(() => { if (!controller.signal.aborted) setDraftLoading(false); });
    return () => controller.abort();
  }, [draftId, workspaceId]);

  useEffect(() => { setReview(null); }, [name, audienceType, selectedTagIds, segmentId, templateId, voiceNote, variables, variableMapping, excludedTagIds, sendMode, scheduledAt, createConversations]);
  const availableTemplates = useMemo(() => loadedTemplate && !templates.some(v => v.id === loadedTemplate.id) ? [...templates, loadedTemplate] : templates, [templates, loadedTemplate]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('message_templates')
      .select('*')
      .eq('status', 'Approved')
      .order('created_at', { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as MessageTemplate[]));
    supabase
      .from('tags')
      .select('*')
      .order('name')
      .then(({ data }) => setTags((data ?? []) as Tag[]));
    supabase
      .from('contact_segments')
      .select('*')
      .order('name')
      .then(({ data }) => setSegments((data ?? []) as ContactSegment[]));
    supabase
      .from('custom_fields')
      .select('*')
      .order('field_name')
      .then(({ data }) => setCustomFields((data ?? []) as CustomField[]));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    const phonesOf = (rows: { phone?: string | null }[] | null | undefined) =>
      (rows ?? []).map((r) => r.phone ?? '').filter((p): p is string => !!p);
    async function loadCount() {
      try {
        if (audienceType === 'all') {
          const [{ count }, { data: sample }] = await Promise.all([
            supabase
              .from('contacts')
              .select('id', { count: 'exact', head: true })
              .eq('opted_out', false),
            supabase.from('contacts').select('phone').eq('opted_out', false).limit(300),
          ]);
          if (!cancelled) {
            setRecipientCount(count ?? 0);
            setSamplePhones(phonesOf(sample));
          }
          return;
        }
        if (audienceType === 'tags') {
          if (selectedTagIds.length === 0) {
            if (!cancelled) {
              setRecipientCount(0);
              setSamplePhones([]);
            }
            return;
          }
          // Paginado: con 1.000 filas por respuesta el contador se quedaba
          // clavado en "1000 destinatarios" para cualquier etiqueta más grande.
          const data = await fetchAllRows<{ contact_id: string }>((from, to) =>
            supabase
              .from('contact_tags')
              .select('contact_id')
              .in('tag_id', selectedTagIds)
              .order('contact_id', { ascending: true })
              .order('tag_id', { ascending: true })
              .range(from, to),
          );
          const ids = [...new Set(data.map((r) => r.contact_id))];
          const { data: cts } = await supabase
            .from('contacts')
            .select('phone')
            .in('id', ids.slice(0, 300))
            .eq('opted_out', false);
          if (!cancelled) {
            setRecipientCount(ids.length);
            setSamplePhones(phonesOf(cts));
          }
          return;
        }
        if (audienceType === 'segment') {
          // Resolve the segment for real (the old code hardcoded type:'all',
          // limit:1 — the count was always ≤1). Same resolver the send path
          // uses, so preview == what actually goes out. Drops opted-out.
          const seg = segments.find((s) => s.id === segmentId);
          if (!segmentId || !seg) {
            if (!cancelled) {
              setRecipientCount(0);
              setSamplePhones([]);
            }
            return;
          }
          const resolved = await resolveSegment(
            supabase,
            seg.workspace_id,
            seg.rules ?? [],
            seg.match_mode,
          );
          const contacts = resolved.contacts.filter(
            (c) => !(c as { opted_out?: boolean }).opted_out,
          );
          if (!cancelled) {
            setRecipientCount(contacts.length);
            setSamplePhones(phonesOf(contacts as { phone?: string | null }[]));
          }
        }
      } catch {
        if (!cancelled) {
          setRecipientCount(null);
          setSamplePhones([]);
        }
      }
    }
    void loadCount();
    return () => {
      cancelled = true;
    };
  }, [audienceType, selectedTagIds, segmentId, segments]);

  const template = useMemo(
    () => voiceNote ? null : availableTemplates.find((t) => t.id === templateId) ?? null,
    [availableTemplates, templateId, voiceNote],
  );

  const templateLabels = useMemo(
    () =>
      Object.fromEntries(
        availableTemplates.map((t) => [t.id, `${t.name} · ${t.language ?? 'es'}`]),
      ),
    [availableTemplates],
  );
  const segmentLabels = useMemo(
    () => Object.fromEntries(segments.map((s) => [s.id, s.name])),
    [segments],
  );
  const audienceLabels = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(AUDIENCE_LABELS) as AudienceType[]).map((k) => [
          k,
          t(AUDIENCE_LABELS[k]),
        ]),
      ),
    [t],
  );

  const templateVars = useMemo(() => {
    if (!template?.body_text) return [] as string[];
    const out = new Set<string>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template.body_text)) !== null) out.add(m[1]);
    return [...out].sort((a, b) => Number(a) - Number(b));
  }, [template]);

  // Precise cost per Meta's model: per-message rate by (destination country,
  // template category), averaged over a sample of the audience's phones and
  // applied to the recipient count. Falls back to the category default when no
  // phones are known yet. Recomputes when the template (→ category) changes.
  const estimatedCost = useMemo(() => {
    if (voiceNote) return null;
    if (recipientCount === null) return null;
    const category = toCategory(template?.category);
    if (samplePhones.length === 0) return recipientCount * rateFor(null, category);
    return estimateFromSample(samplePhones, recipientCount, category);
  }, [recipientCount, samplePhones, template, voiceNote]);

  function toggleTag(id: string) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function validate(): string | null {
    if (!name.trim()) return t('broadcasts.validationName');
    if (voiceNote && !validVoiceConfig(voiceNote)) return t('voiceNotes.invalidText');
    if (!template && !voiceNote) return t('broadcasts.validationTemplate');
    if (audienceType === 'tags' && selectedTagIds.length === 0)
      return t('broadcasts.validationTag');
    if (audienceType === 'segment' && !segmentId) return t('broadcasts.validationSegment');
    if (sendMode === 'schedule') {
      if (!scheduledAt) return t('broadcasts.validationSchedule');
      const ts = new Date(scheduledAt).getTime();
      if (Number.isNaN(ts)) return t('broadcasts.validationInvalidDate');
      if (ts <= Date.now()) return t('broadcasts.validationFutureDate');
    }
    return null;
  }

  async function handleSend() {
    const err = validate();
    if (err) return toast.error(err);
    if (!template && !voiceNote) return;
    if (draftId) {
      setEditBusy(true);
      try { setReview(await persistExistingDraft()); }
      catch (error) { toast.error(error instanceof CampaignDraftError ? error.message : t('broadcasts.draftUnavailable')); }
      finally { setEditBusy(false); }
      return;
    }
    try {
      const broadcastId = await createAndSendBroadcast({
        name,
        template,
        voiceNote,
        locale,
        audience: {
          type: audienceType,
          tagIds: audienceType === 'tags' ? selectedTagIds : undefined,
          segmentId: audienceType === 'segment' ? segmentId : undefined,
        },
        variables: Object.fromEntries(
          templateVars.map((v) => {
            const mapped = variableMapping[v];
            if (mapped) {
              if (BUILTIN_FIELD_OPTIONS.some((b) => b.value === mapped)) {
                return [v, { type: 'field' as const, value: mapped }];
              }
              return [v, { type: 'custom_field' as const, value: mapped }];
            }
            return [v, { type: 'static' as const, value: variables[v] ?? '' }];
          }),
        ),
        scheduledAt:
          sendMode === 'schedule' ? new Date(scheduledAt).toISOString() : null,
        createConversations,
      });

      toast.success(
        voiceNote ? t('voiceNotes.queued') : sendMode === 'schedule'
          ? t('broadcasts.campaignScheduled')
          : t('broadcasts.campaignSent'),
      );
      router.push(`/campanas/${broadcastId}`);
    } catch {
      toast.error(t('broadcasts.sendFailed'));
    }
  }

  async function handleSendTest() {
    if (!template) return toast.error(t('broadcasts.validationTemplate'));
    if (!testPhone.trim()) return toast.error(t('broadcasts.validationTestPhone'));
    setSendingTest(true);
    try {
      const res = await fetchWithCsrf('/api/broadcasts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          phone: testPhone.trim(),
          variables,
        }),
      });
      const data = await res.json();
      if (data?.sent) {
        toast.success(t('broadcasts.testSent'));
      } else {
        toast.error(data?.error ?? t('broadcasts.testFailed'));
      }
    } catch {
      toast.error(t('broadcasts.testFailed'));
    } finally {
      setSendingTest(false);
    }
  }

  async function handleSaveDraft() {
    const err = validate();
    if (err) return toast.error(err);
    if (!template && !voiceNote) return;
    if (draftId) {
      setEditBusy(true);
      try { await persistExistingDraft(); toast.success(t('broadcasts.draftSaved')); router.push(`/campanas/${draftId}`); }
      catch (error) { toast.error(error instanceof CampaignDraftError ? error.message : t('broadcasts.draftUnavailable')); }
      finally { setEditBusy(false); }
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return toast.error(t('broadcasts.noSession'));
    if (!workspace?.id) return toast.error(t('broadcasts.noSession'));
    const cleanMapping = Object.fromEntries(
      Object.entries(variableMapping).filter(([, v]) => v),
    );
    const { error } = await supabase.from('broadcasts').insert({
      user_id: user.id,
      workspace_id: workspace.id,
      name: name.trim(),
      template_name: template?.name ?? 'voice_note',
      voice_note: voiceNote,
      template_language: template?.language ?? locale,
      template_variables: variables,
      variable_mapping: Object.keys(cleanMapping).length > 0 ? cleanMapping : null,
      audience_filter: {
        type: audienceType,
        tagIds: audienceType === 'tags' ? selectedTagIds : undefined,
        segmentId: audienceType === 'segment' ? segmentId : undefined,
      },
      create_conversations: createConversations,
      scheduled_at: sendMode === 'schedule' ? new Date(scheduledAt).toISOString() : null,
      status: 'draft',
      total_recipients: 0,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    });
    if (error) return toast.error(t('broadcasts.saveDraftError', { error: error.message }));
    toast.success(t('broadcasts.draftSaved'));
    router.push('/campanas');
  }

  async function persistExistingDraft() {
    if (!draftId || !draftVersion || draftWorkspace !== workspace?.id) throw new CampaignDraftError(t('broadcasts.draftChanged'));
    const config: DraftConfig = { name, template_name: template?.name ?? 'voice_note', template_language: template?.language ?? locale, voice_note: voiceNote,
      variables: Object.fromEntries(templateVars.map(key => [key, { type: variableMapping[key] ? BUILTIN_FIELD_OPTIONS.some(v => v.value === variableMapping[key]) ? 'field' : 'custom_field' : 'static', value: variableMapping[key] || variables[key] || '' }])),
      audience_filter: { type: audienceType, tagIds: audienceType === 'tags' ? selectedTagIds : undefined, segmentId: audienceType === 'segment' ? segmentId : undefined, excludeTagIds: excludedTagIds },
      scheduled_at: sendMode === 'schedule' ? originalSchedule && formatLocalDateTimeInput(new Date(originalSchedule)) === scheduledAt ? originalSchedule : new Date(scheduledAt).toISOString() : null, create_conversations: createConversations };
    const res = await fetchWithCsrf('/api/broadcasts/draft', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draftId, expected_updated_at: draftVersion, config, expected_template: draftTemplateProof(template as unknown as Record<string, unknown> | null) }) });
    const data = await draftResponse(res, t('broadcasts.draftUnavailable'));
    setDraftVersion(data.updated_at);
    return data as { updated_at: string; total_recipients: number; estimated_cost: number | null };
  }

  async function confirmDraftSend() {
    if (!review || !draftId || draftWorkspace !== workspace?.id) return;
    setEditBusy(true);
    try {
      const res = await fetchWithCsrf('/api/broadcasts/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: draftId, expected_updated_at: review.updated_at }) });
      await draftResponse(res, t('broadcasts.draftUnavailable'));
      toast.success(t('broadcasts.draftQueued')); router.push(`/campanas/${draftId}`);
    } catch (error) { setReview(null); toast.error(error instanceof CampaignDraftError ? error.message : t('broadcasts.draftUnavailable')); }
    finally { setEditBusy(false); }
  }

  const previewBody = useMemo(() => {
    if (!template?.body_text) {
      return t('broadcasts.choosTemplatePreview');
    }
    return template.body_text.replace(/\{\{(\d+)\}\}/g, (_, n: string) => {
      const v = variables[n];
      return v && v.trim() ? v : `{{${n}}}`;
    });
  }, [template, variables, t]);

  const previewHeaderType: TemplateHeaderType =
    (template?.header_type as TemplateHeaderType | undefined) ?? 'none';
  const previewButtons = (template?.buttons ?? []) as unknown as TemplateButtonInput[];

  if (draftLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="size-5 animate-spin" /></div>;
  if (draftError) return <div className="space-y-3"><p className="text-sm text-destructive">{draftError === 'broadcast_draft_unavailable' ? t('broadcasts.draftUnavailable') : draftError}</p><Button variant="outline" onClick={() => router.push('/campanas')}>{t('broadcasts.goBack')}</Button></div>;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/campanas')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t(draftId ? 'broadcasts.editDraft' : 'broadcasts.newCampaign')}</h1>
        </div>
      </div>

      <fieldset disabled={editBusy || isProcessing} className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="space-y-6 p-6">
            <Field label={t('broadcasts.campaignNameField')}>
              <Input
                placeholder={t('broadcasts.campaignNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-background"
              />
            </Field>

            <Field label={t('broadcasts.recipientsField')}>
              <Select
                value={audienceType}
                onValueChange={(v) => setAudienceType(v as AudienceType)}
              >
                <SelectTrigger className="w-full bg-background">
                  <SelectValue labels={audienceLabels} />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUDIENCE_LABELS) as AudienceType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(AUDIENCE_LABELS[k])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {audienceType === 'segment' && (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <Select
                      value={segmentId}
                      onValueChange={(v) => setSegmentId(v ?? '')}
                    >
                      <SelectTrigger className="flex-1 bg-background">
                        <SelectValue
                          labels={segmentLabels}
                          placeholder={
                            segments.length === 0 ? t('broadcasts.noSegmentsYet') : ''
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {segments.length === 0 && (
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">
                            {t('broadcasts.noSegments')}
                          </div>
                        )}
                        {segments.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowSegmentModal(true)}
                      className="border-border text-foreground hover:bg-accent"
                    >
                      <Plus className="size-4" />
                      {t('broadcasts.createSegment')}
                    </Button>
                  </div>
                </div>
              )}
              {audienceType === 'tags' && (
                <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-2">
                  {tags.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t('broadcasts.noTags')}</p>
                  )}
                  {tags.map((t) => {
                    const on = selectedTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        className={cn(
                          'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                          on
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>

            {/* Schedule */}
            <Field label={t('broadcasts.whenToSendField')}>
              <div className="grid grid-cols-2 gap-2">
                <ModeOption
                  active={sendMode === 'now'}
                  onClick={() => setSendMode('now')}
                  title={t('broadcasts.modeNow')}
                  icon={<Send className="size-4" />}
                />
                <ModeOption
                  active={sendMode === 'schedule'}
                  onClick={() => setSendMode('schedule')}
                  title={t('broadcasts.modeSchedule')}
                  icon={<CalendarClock className="size-4" />}
                />
              </div>
              {sendMode === 'schedule' && (
                <SchedulePicker value={scheduledAt} onChange={setScheduledAt} />
              )}
            </Field>

            <VoiceNoteEditor value={voiceNote} onChange={setVoiceNote} />
            {voiceNote && <p className="text-xs text-muted-foreground">{t('voiceNotes.campaignHint')}</p>}
            {draftId && <Field label={t('broadcasts.draftExcludeTags')}>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => <button key={tag.id} type="button" onClick={() => setExcludedTagIds(ids => ids.includes(tag.id) ? ids.filter(id => id !== tag.id) : [...ids, tag.id])}
                  className={cn('rounded-full px-2.5 py-0.5 text-xs', excludedTagIds.includes(tag.id) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                  {tag.name}
                </button>)}
              </div>
            </Field>}
            {!voiceNote && <Field label={t('broadcasts.templateField')}>
              <Select value={templateId} onValueChange={(v) => setTemplateId(v ?? '')}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue labels={templateLabels} placeholder="" />
                </SelectTrigger>
                <SelectContent>
                  {templates.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      {t('broadcasts.noApprovedTemplates')}
                    </div>
                  )}
                  {availableTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.language ?? 'es'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>}
            {!voiceNote && templateVars.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="space-y-2">
                  {templateVars.map((v) => {
                    const mapped = variableMapping[v] ?? '';
                    const isFixed = !mapped;
                    return (
                      <div
                        key={v}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5"
                      >
                        <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-accent-ink">
                          {`{{${v}}}`}
                        </span>
                        <select
                          value={mapped}
                          onChange={(e) =>
                            setVariableMapping((prev) => ({
                              ...prev,
                              [v]: e.target.value,
                            }))
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          {BUILTIN_FIELD_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {t(opt.label)}
                            </option>
                          ))}
                          {customFields.length > 0 && (
                            <optgroup label={t('broadcasts.customFieldsGroup')}>
                              {customFields.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.field_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {isFixed && (
                          <Input
                            placeholder={t('broadcasts.fieldFixedValue')}
                            value={variables[v] ?? ''}
                            onChange={(e) =>
                              setVariables((prev) => ({ ...prev, [v]: e.target.value }))
                            }
                            className="h-8 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{t('broadcasts.summary')}</p>
                  <p className="text-xs text-muted-foreground">
                    {recipientCount === null
                      ? t('broadcasts.calculatingRecipients')
                      : t('broadcasts.recipientsCount', {
                          count: fmt.number(recipientCount),
                        })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">{t('broadcasts.estimatedCost')}</p>
                  <p className="text-sm font-semibold text-foreground">
                    {estimatedCost === null ? '—' : fmt.currency(estimatedCost, 'USD')}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-sm font-medium text-foreground">{t('broadcasts.testSend')}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="+57 300 1234567"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="h-9 flex-1 min-w-[180px] bg-background"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendTest}
                  disabled={sendingTest || !template || Boolean(voiceNote)}
                  className="border-border"
                >
                  {sendingTest ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('broadcasts.sending')}
                    </>
                  ) : (
                    t('broadcasts.sendTest')
                  )}
                </Button>
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={createConversations}
                onChange={(e) => setCreateConversations(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>{t('broadcasts.openConversationPerRecipient')}</span>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border bg-card/60 px-6 py-4">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('broadcasts.saveDraft')}
            </button>
            <Button
              variant="outline"
              onClick={() => router.push('/campanas')}
              className="border-border text-foreground hover:bg-accent"
            >
              {t('broadcasts.cancel')}
            </Button>
            <Button
              onClick={handleSend}
              disabled={isProcessing}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('broadcasts.sending')}
                </>
              ) : sendMode === 'schedule' ? (
                t('broadcasts.modeSchedule')
              ) : (
                t('broadcasts.sendButton')
              )}
            </Button>
          </div>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <WhatsappPreview
            headerType={previewHeaderType}
            headerText={template?.header_content}
            bodyText={previewBody}
            footerText={template?.footer_text}
            buttons={previewButtons}
          />
        </aside>
      </fieldset>

      <Dialog open={Boolean(review)} onOpenChange={open => { if (!open && !editBusy) setReview(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('broadcasts.draftConfirm')}</DialogTitle></DialogHeader>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">{t('broadcasts.draftConfirmCount', { count: fmt.number(review?.total_recipients ?? 0) })}</p>
          {review?.estimated_cost != null && <p className="text-sm">{t('broadcasts.estimatedCost')}: {fmt.currency(review.estimated_cost, 'USD')}</p>}
          {sendMode === 'schedule' && scheduledAt && <p className="text-sm">{fmt.dateTime(new Date(scheduledAt).toISOString(), { dateStyle: 'short', timeStyle: 'short' })}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={editBusy} onClick={() => setReview(null)}>{t('broadcasts.cancel')}</Button>
            <Button disabled={editBusy || !review?.total_recipients} onClick={confirmDraftSend}>{editBusy && <Loader2 className="size-4 animate-spin" />}{t('broadcasts.draftQueue')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline segment creator — no more bouncing to /contactos. On save we
          refresh the list, auto-select the new segment and stay in the wizard
          so campaign creation continues. Its live preview updates as rules
          change (same resolver as the count above). */}
      {showSegmentModal && workspace && (
        <SegmentEditor
          workspaceId={workspace.id}
          tags={tags}
          segment={{ name: '', description: '', match_mode: 'all', rules: [] }}
          onClose={() => setShowSegmentModal(false)}
          onSaved={async (saved) => {
            const { data } = await createClient()
              .from('contact_segments')
              .select('*')
              .order('name');
            setSegments((data ?? []) as ContactSegment[]);
            if (saved?.id) {
              setAudienceType('segment');
              setSegmentId(saved.id);
            }
            setShowSegmentModal(false);
          }}
        />
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  hint,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/60 bg-primary/10'
          : 'border-border bg-background hover:border-foreground/30',
      )}
    >
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {hint && (
          <span className="block text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
    </button>
  );
}

function SchedulePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const summary = describeScheduledAt(value, t);
  const tz =
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap gap-1.5">
        {SCHEDULE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(formatLocalDateTimeInput(applyPreset(p, new Date())))}
            className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent"
          >
            {t(p.label)}
          </button>
        ))}
      </div>
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background"
      />
      {summary && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{summary}</span>
          {tz ? ` · ${tz}` : ''}
        </p>
      )}
    </div>
  );
}
