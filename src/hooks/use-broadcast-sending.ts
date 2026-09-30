'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, MessageTemplate } from '@/types';
import { recordBroadcastConversation } from '@/lib/broadcasts/conversations';
import { renderTemplateBody } from '@/lib/whatsapp/template-render';
import { resolveSegment } from '@/lib/segments/resolve';
import { escapeLike } from '@/lib/security/like';
import { chunk, fetchAllRows } from '@/lib/supabase/paginate';
import type { ContactSegment } from '@/lib/segments/types';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import type { VoiceNoteConfig } from '@/lib/voice-notes/types';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve-browser';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv' | 'segment';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** When type === 'segment'. */
  segmentId?: string;
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  voiceNote?: VoiceNoteConfig | null;
  locale?: string;
  name: string;
  template: MessageTemplate | null;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /** ISO timestamp to send later. Omit / past → send immediately. */
  scheduledAt?: string | null;
  /** Open an inbox conversation per recipient when the template goes out. */
  createConversations?: boolean;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Se parte la lista de ids por el largo de URL de PostgREST.
  for (const slice of chunk(contactIds, 300)) {
    // Y dentro del lote se pagina: cada contacto puede tener varios campos, así
    // que 300 contactos pasan de las 1.000 filas por respuesta.
    const data = await fetchAllRows<{
      contact_id: string;
      custom_field_id: string;
      value: string | null;
    }>((from, to) =>
      supabase
        .from('contact_custom_values')
        .select('contact_id, custom_field_id, value')
        .in('contact_id', slice)
        .order('contact_id', { ascending: true })
        .order('custom_field_id', { ascending: true })
        .range(from, to),
    );

    for (const row of data) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const fetchWithCsrf = useFetchWithCsrf();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig, workspaceId: string): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    // Every branch filters opted_out=false at fetch time so the
    // immediate-send path matches the cron path (which already
    // gates opt-out before send). Previously this hook silently
    // messaged opted-out contacts on "Enviar ahora".
    if (audience.type === 'all') {
      contacts = await fetchAllRows<Contact>((from, to) =>
        supabase
          .from('contacts')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('opted_out', false)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      );
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      // El filtro por etiqueta va sobre el join: traerse la lista de vínculos y
      // reenviarla en un `.in()` se quedaba en los primeros 1.000 (PostgREST no
      // devuelve más por respuesta) y la campaña salía con la mitad de la gente.
      contacts = await fetchAllRows<Contact>((from, to) =>
        supabase
          .from('contacts')
          .select('*, contact_tags!inner(tag_id)')
          .eq('workspace_id', workspaceId)
          .in('contact_tags.tag_id', audience.tagIds!)
          .eq('opted_out', false)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      );
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      const resolved = await upsertCsvContacts(supabase, audience.csvContacts, workspaceId);
      // CSV upserts return everything; drop opted-out before send.
      contacts = resolved.filter((c) => !(c as Contact & { opted_out?: boolean }).opted_out);
    } else if (audience.type === 'segment' && audience.segmentId) {
      const { data: seg, error: segErr } = await supabase
        .from('contact_segments')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', audience.segmentId)
        .maybeSingle();
      if (segErr || !seg) {
        throw new Error('No se encontró el segmento seleccionado.');
      }
      const s = seg as ContactSegment;
      const resolved = await resolveSegment(
        supabase,
        s.workspace_id,
        s.rules ?? [],
        s.match_mode,
      );
      contacts = resolved.contacts.filter(
        (c) => !(c as Contact & { opted_out?: boolean }).opted_out,
      );
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      // Paginado por seguridad: una lista de exclusión recortada a 1.000 no
      // excluye — le manda la campaña a quien el merchant pidió dejar afuera.
      const excludeRows = await fetchAllRows<{ contact_id: string }>((from, to) =>
        supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', audience.excludeTagIds!)
          .order('contact_id', { ascending: true })
          .order('tag_id', { ascending: true })
          .range(from, to),
      );
      const excludedIds = new Set(excludeRows.map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts.filter((contact) => contact.workspace_id === workspaceId);
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
    workspaceId: string,
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Búsqueda de los que ya existen, en lotes por largo de URL y paginada por
    // el tope de 1.000 filas: si la lista vuelve corta, los que faltan se
    // vuelven a insertar y el CSV duplica contactos.
    const byPhone = new Map<string, Contact>();
    for (const slice of chunk(phones, 300)) {
      const existing = await fetchAllRows<Contact>((from, to) =>
        supabase
          .from('contacts')
          .select('*')
          .eq('user_id', user.id)
          .eq('workspace_id', workspaceId)
          .in('phone', slice)
          .order('id', { ascending: true })
          .range(from, to),
      );
      for (const c of existing) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        workspace_id: workspaceId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    const INSERT_CHUNK = 200;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive. Se arma de nuevo en
    // cada página porque el builder es de un solo uso.
    const page = (from: number, to: number) => {
      let query = supabase
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', fieldId);
      if (operator === 'is') query = query.eq('value', value);
      else if (operator === 'is_not') query = query.neq('value', value);
      else if (operator === 'contains')
        query = query.ilike('value', `%${escapeLike(value)}%`);
      return query.order('contact_id', { ascending: true }).range(from, to);
    };

    const matches = await fetchAllRows<{ contact_id: string }>(page);

    const contactIds = [...new Set(matches.map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const out: Contact[] = [];
    for (const slice of chunk(contactIds, 300)) {
      const rows = await fetchAllRows<Contact>((from, to) =>
        supabase
          .from('contacts')
          .select('*')
          .in('id', slice)
          .eq('opted_out', false)
          .order('id', { ascending: true })
          .range(from, to),
      );
      out.push(...rows);
    }
    return out;
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
      if (!workspaceId) throw new Error('workspace_required');
      const contacts = await resolveAudience(payload.audience, workspaceId);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // Resolve per-recipient template params NOW (before insert) so a
      // scheduled campaign carries fully-resolved params and the cron
      // sender never has to re-run audience/variable resolution.
      const customValueIndex = await fetchCustomValueIndex(
        supabase,
        contacts.map((c) => c.id),
      );
      const paramsByContact = new Map<string, string[]>();
      for (const c of contacts) {
        paramsByContact.set(
          c.id,
          resolveVariables(payload.variables, c, customValueIndex.get(c.id)),
        );
      }

      // Decide immediate vs scheduled. A scheduled_at in the past is
      // treated as "send now".
      const scheduledAt = payload.scheduledAt
        ? new Date(payload.scheduledAt)
        : null;
      const isScheduled =
        scheduledAt !== null &&
        !Number.isNaN(scheduledAt.getTime()) &&
        scheduledAt.getTime() > Date.now();

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          workspace_id: workspaceId,
          name: payload.name,
          template_name: payload.template?.name ?? 'voice_note',
          voice_note: payload.voiceNote ?? null,
          template_language: payload.template?.language ?? (payload.voiceNote ? payload.locale ?? 'es' : 'en_US'),
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            segmentId: payload.audience.segmentId,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          create_conversations: payload.createConversations ?? false,
          scheduled_at: isScheduled ? scheduledAt!.toISOString() : payload.voiceNote ? new Date().toISOString() : null,
          status: payload.voiceNote ? 'draft' : isScheduled ? 'scheduled' : 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Insert recipient rows (with resolved params) ──────
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
        params: paramsByContact.get(contact.id) ?? [],
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // Scheduled: rows are queued with status 'scheduled'. The
      // /api/broadcasts/cron route will fan them out when due. Stop here.
      if (payload.voiceNote) {
        const { error } = await supabase.from('broadcasts').update({ status: 'scheduled' }).eq('id', broadcast.id);
        if (error) throw new Error(error.message);
        setProgress(100);
        return broadcast.id;
      }
      if (isScheduled) {
        setProgress(100);
        return broadcast.id;
      }

      // ── Step 4: Fetch recipients (joined contact) for the send loop
      if (!payload.template) throw new Error('template_required');
      setProgress(30);
      const { data: recipients, error: recipientsFetchError } = await supabase
        .from('broadcast_recipients')
        .select('*, contact:contacts(*)')
        .eq('broadcast_id', broadcast.id);

      if (recipientsFetchError || !recipients) {
        throw new Error('Failed to fetch broadcast recipients');
      }

      // Best-effort: resolve the workspace's WhatsApp connection once so
      // "create conversations" can stamp connection_id. Null is fine.
      let connectionId: string | null = null;
      if (payload.createConversations) {
        const wsId = recipients.find((r) => r.contact?.workspace_id)?.contact
          ?.workspace_id as string | undefined;
        if (wsId) {
          const { data: conn } = await supabase
            .from('channel_connections')
            .select('id')
            .eq('workspace_id', wsId)
            .eq('channel', 'whatsapp')
            .limit(1)
            .maybeSingle();
          connectionId = (conn?.id as string | undefined) ?? null;
        }
      }

      let failedCount = 0;
      const totalRecipients = recipients.length;

      for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
        const batch = recipients.slice(i, i + SEND_BATCH_SIZE);

        const apiRecipients = batch
          .filter((r) => r.contact?.phone)
          .map((r) => ({
            phone: r.contact!.phone as string,
            params: r.contact
              ? resolveVariables(
                  payload.variables,
                  r.contact,
                  customValueIndex.get(r.contact.id),
                )
              : [],
          }));

        if (apiRecipients.length === 0) continue;

        try {
          const res = await fetchWithCsrf('/api/whatsapp/broadcast', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipients: apiRecipients,
              template_name: payload.template.name,
              template_language: payload.template.language ?? 'en_US',
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || 'Broadcast API request failed');
          }

          const resultsByPhone = new Map<string, BroadcastApiResult>();
          for (const r of (data.results ?? []) as BroadcastApiResult[]) {
            resultsByPhone.set(r.phone, r);
          }

          for (const recipient of batch) {
            const phone = recipient.contact?.phone;
            const result = phone ? resultsByPhone.get(phone) : undefined;

            if (!result) {
              failedCount++;
              await supabase
                .from('broadcast_recipients')
                .update({
                  status: 'failed',
                  error_message: 'No phone number on contact',
                })
                .eq('id', recipient.id);
              continue;
            }

            if (result.status === 'sent') {
              await supabase
                .from('broadcast_recipients')
                .update({
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  whatsapp_message_id: result.whatsapp_message_id ?? null,
                  error_message: null,
                })
                .eq('id', recipient.id);

              if (payload.createConversations && recipient.contact?.id) {
                try {
                  await recordBroadcastConversation(supabase, {
                    contactId: recipient.contact.id,
                    workspaceId: recipient.contact.workspace_id ?? null,
                    connectionId,
                    templateName: payload.template.name,
                    // Texto REAL que recibió esta persona. Antes se guardaba
                    // el cuerpo crudo con {{1}} {{2}} sin sustituir (idéntico
                    // para todos), y la IA lee el historial como contexto: al
                    // responder la campaña, le llegaban los marcadores en vez
                    // del mensaje. Los params ya se resuelven para el envío;
                    // aquí reusamos exactamente los mismos.
                    bodyPreview: payload.template.body_text
                      ? renderTemplateBody(
                          payload.template.body_text,
                          recipient.contact
                            ? resolveVariables(
                                payload.variables,
                                recipient.contact,
                                customValueIndex.get(recipient.contact.id),
                              )
                            : [],
                        )
                      : payload.template.name,
                    whatsappMessageId: result.whatsapp_message_id ?? null,
                    broadcastName: payload.name ?? null,
                  });
                } catch (convErr) {
                  console.error('[broadcast] conversation create failed:', convErr);
                }
              }
            } else {
              failedCount++;
              await supabase
                .from('broadcast_recipients')
                .update({
                  status: 'failed',
                  error_message: result.error ?? 'Unknown error',
                })
                .eq('id', recipient.id);
            }
          }
        } catch (err) {
          for (const recipient of batch) {
            failedCount++;
            await supabase
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                error_message: err instanceof Error ? err.message : 'Unknown error',
              })
              .eq('id', recipient.id);
          }
        }

        const progressPct =
          30 + Math.round(((i + batch.length) / totalRecipients) * 60);
        setProgress(progressPct);

        if (i + SEND_BATCH_SIZE < recipients.length) {
          await sleep(SEND_BATCH_DELAY_MS);
        }
      }

      // ── Step 5: Finalize status ───────────────────────────────────
      // Aggregate counts are maintained by the DB trigger (migration
      // 003); we only flip the final status here.
      setProgress(95);
      const finalStatus = failedCount === totalRecipients ? 'failed' : 'sent';
      await supabase
        .from('broadcasts')
        .update({ status: finalStatus })
        .eq('id', broadcast.id);

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
