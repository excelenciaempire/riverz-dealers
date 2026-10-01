import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContactSegment } from '@/lib/segments/types'
import { resolveSegment } from '@/lib/segments/resolve'
import { chunk } from '@/lib/supabase/paginate'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { sanitizeTemplateTextParameter } from '@/lib/whatsapp/meta-api'
import { loadBroadcastTemplate } from './delivery'
import { resolveContactField, templateVariableNumbers } from './variables'
import type { DraftConfig } from './draft'

export const MAX_EDITABLE_DRAFT_RECIPIENTS = 10000
type Contact = Record<string, unknown> & { id: string }
type QueryPage<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
async function all<T>(page: QueryPage<T>, max = MAX_EDITABLE_DRAFT_RECIPIENTS) {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const result = await page(from, from + 999)
    if (result.error) throw new Error('broadcast_draft_unavailable')
    rows.push(...(result.data ?? []))
    if (rows.length > max) throw new Error('broadcast_draft_too_large')
    if ((result.data?.length ?? 0) < 1000) return rows
  }
}

/** Uses the same template authority as persisted sends; no generation or Meta calls. */
export async function draftTemplate(db: SupabaseClient, ws: string, config: DraftConfig, creator: string) {
  if (config.voice_note) return null
  const proof = await loadBroadcastTemplate(db, ws, config.template_name, config.template_language, creator)
  if (!proof) throw new Error('broadcast_draft_template')
  const result = await db.from('message_templates').select('id,name,language,category,status,body_text,header_type,header_content,footer_text,buttons,waba_id,user_id')
    .eq('workspace_id', ws).eq('id', proof.id).maybeSingle()
  if (result.error) throw new Error('broadcast_draft_unavailable')
  const row = result.data
  if (!row || row.body_text !== proof.body_text || row.category !== proof.category || row.status !== proof.status) throw new Error('broadcast_draft_changed')
  if ((row.header_type && row.header_type !== 'text') || /\{\{/.test(row.header_content ?? '') ||
    (Array.isArray(row.buttons) && row.buttons.some((v: { url?: string; url_variable?: string }) => v.url?.includes('{{') || v.url_variable))) throw new Error('broadcast_draft_template')
  const numbers = templateVariableNumbers(row.body_text)
  if (numbers.length !== Object.keys(config.variables).length || numbers.some((n, i) => n !== i + 1 || !config.variables[String(n)])) throw new Error('broadcast_draft_invalid')
  return row
}

/** Resolve the complete reviewed audience. A size guard fails rather than
 * returning a truncated list; recipients are deduplicated by contact and phone. */
export async function prepareDraftRecipients(db: SupabaseClient, ws: string, config: DraftConfig) {
  const audience = config.audience_filter
  const tagIds = [...new Set([...(audience.type === 'tags' ? audience.tagIds ?? [] : []), ...audience.excludeTagIds ?? []])]
  if (tagIds.length) {
    const result = await db.from('tags').select('id').eq('workspace_id', ws).in('id', tagIds)
    if (result.error) throw new Error('broadcast_draft_unavailable')
    if (result.data?.length !== tagIds.length) throw new Error('broadcast_draft_invalid')
  }
  let contacts: Contact[]
  if (audience.type === 'segment') {
    const result = await db.from('contact_segments').select('*').eq('workspace_id', ws).eq('id', audience.segmentId!).maybeSingle()
    if (result.error) throw new Error('broadcast_draft_unavailable')
    if (!result.data) throw new Error('broadcast_draft_invalid')
    const segment = result.data as ContactSegment
    // The existing resolver caps its scan. Fail before using a partial segment.
    const count = await db.from('contacts').select('id', { count: 'exact', head: true }).eq('workspace_id', ws)
    if (count.error || count.count == null) throw new Error('broadcast_draft_unavailable')
    if (count.count > 100000) throw new Error('broadcast_draft_too_large')
    contacts = (await resolveSegment(db, ws, segment.rules ?? [], segment.match_mode, { excludeOptedOut: true })).contacts as unknown as Contact[]
  } else {
    contacts = await all<Contact>((from, to) => {
      const q = db.from('contacts').select(audience.type === 'tags' ? '*,contact_tags!inner(tag_id)' : '*').eq('workspace_id', ws).eq('opted_out', false).order('id').range(from, to)
      return (audience.type === 'tags' ? q.in('contact_tags.tag_id', audience.tagIds!) : q).overrideTypes<Contact[], { merge: false }>()
    })
  }
  const excluded = new Set<string>()
  if (audience.excludeTagIds?.length) for (const ids of chunk(contacts.map(c => c.id), 200)) {
    const links = await all<{ contact_id: string }>((from, to) => db.from('contact_tags').select('contact_id').in('contact_id', ids).in('tag_id', audience.excludeTagIds!).order('contact_id').order('tag_id').range(from, to), 20000)
    links.forEach(link => excluded.add(link.contact_id))
  }
  const ids = new Set<string>(), phones = new Set<string>()
  contacts = contacts.filter(c => {
    const phone = sanitizePhoneForMeta(String(c.phone ?? ''))
    if (c.workspace_id !== ws || c.opted_out === true || excluded.has(c.id) || ids.has(c.id) || !isValidE164(phone) || phones.has(phone)) return false
    ids.add(c.id); phones.add(phone); return true
  })
  if (contacts.length > MAX_EDITABLE_DRAFT_RECIPIENTS) throw new Error('broadcast_draft_too_large')
  const fields = [...new Set(Object.values(config.variables).filter(v => v.type === 'custom_field').map(v => v.value))]
  const values = new Map<string, Map<string, string>>()
  if (fields.length) {
    const owned = await db.from('custom_fields').select('id').eq('workspace_id', ws).in('id', fields)
    if (owned.error) throw new Error('broadcast_draft_unavailable')
    if (owned.data?.length !== fields.length) throw new Error('broadcast_draft_invalid')
    for (const slice of chunk(contacts.map(c => c.id), 200)) {
      const rows = await all<{ contact_id: string; custom_field_id: string; value: string | null }>((from, to) => db.from('contact_custom_values').select('contact_id,custom_field_id,value').in('contact_id', slice).in('custom_field_id', fields).order('contact_id').order('custom_field_id').range(from, to), 20000)
      rows.forEach(r => { const map = values.get(r.contact_id) ?? new Map<string, string>(); map.set(r.custom_field_id, r.value ?? ''); values.set(r.contact_id, map) })
    }
  }
  const positions = Object.keys(config.variables).sort((a, b) => Number(a) - Number(b))
  let bytes = 2
  return contacts.map(c => {
    const recipient = { contact_id: c.id, phone: sanitizePhoneForMeta(String(c.phone ?? '')), params: config.voice_note ? [] : positions.map(key => {
      const v = config.variables[key]
      return sanitizeTemplateTextParameter(v.type === 'static' ? v.value : v.type === 'field' ? resolveContactField(v.value, c) ?? '' : values.get(c.id)?.get(v.value) ?? '')
    }) }
    bytes += Buffer.byteLength(JSON.stringify(recipient), 'utf8') + 1
    if (bytes > 20000000) throw new Error('broadcast_draft_too_large')
    return recipient
  })
}
