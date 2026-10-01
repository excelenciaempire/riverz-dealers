import { z } from 'zod'
import { BUILTIN_FIELDS } from './variables'
import { validVoiceConfig, type VoiceNoteConfig } from '@/lib/voice-notes/types'

const position = z.string().regex(/^[1-9]\d*$/).refine(v => Number(v) <= 64)
const variable = z.object({ type: z.enum(['static', 'field', 'custom_field']), value: z.string().max(4096) }).strict()
  .refine(v => v.type === 'static' || (v.type === 'field' ? BUILTIN_FIELDS.has(v.value) : z.string().uuid().safeParse(v.value).success))
export const draftConfigSchema = z.object({
  name: z.string().trim().min(1).max(200),
  template_name: z.string().min(1).max(512),
  template_language: z.string().min(2).max(30),
  voice_note: z.custom<VoiceNoteConfig>(validVoiceConfig).nullable(),
  variables: z.record(position, variable),
  audience_filter: z.object({ type: z.enum(['all', 'tags', 'segment']), tagIds: z.array(z.string().uuid()).max(100).optional(), segmentId: z.string().uuid().optional(), excludeTagIds: z.array(z.string().uuid()).max(100).optional() }).strict()
    .refine(a => (a.type !== 'tags' || Boolean(a.tagIds?.length)) && (a.type !== 'segment' || Boolean(a.segmentId))),
  scheduled_at: z.string().datetime({ offset: true }).nullable(),
  create_conversations: z.boolean(),
}).strict()
export type DraftConfig = z.infer<typeof draftConfigSchema>
const templateProofSchema = z.object({ body_text: z.string().max(4096), category: z.string().max(30), header_type: z.string().nullable(), header_content: z.string().nullable(), footer_text: z.string().nullable(), buttons: z.array(z.unknown()).max(10).nullable() }).strict()
export const draftWriteSchema = z.object({ id: z.string().uuid(), expected_updated_at: z.string().datetime({ offset: true }), config: draftConfigSchema, expected_template: templateProofSchema.nullable() }).strict()
export const draftLaunchSchema = z.object({ id: z.string().uuid(), expected_updated_at: z.string().datetime({ offset: true }) }).strict()
export function draftTemplateProof(row: Record<string, unknown> | null) {
  if (!row) return null
  return { body_text: row.body_text, category: String(row.category ?? '').toLowerCase(), header_type: row.header_type ?? null, header_content: row.header_content ?? null, footer_text: row.footer_text ?? null, buttons: row.buttons ?? null }
}

/** Read the formats saved by the manual editor, hook and Operator without
 * interpreting unsupported audiences or malformed values as an empty draft. */
export function editableDraft(row: Record<string, unknown>): DraftConfig {
  const mapping = (row.variable_mapping ?? {}) as Record<string, unknown>
  const stored = (row.template_variables ?? {}) as Record<string, unknown>
  if (typeof mapping !== 'object' || Array.isArray(mapping) || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('broadcast_draft_invalid')
  const variables: DraftConfig['variables'] = {}
  for (const key of new Set([...Object.keys(stored), ...Object.keys(mapping)])) {
    const field = mapping[key], value = stored[key]
    if (field != null) {
      if (typeof field !== 'string') throw new Error('broadcast_draft_invalid')
      variables[key] = { type: BUILTIN_FIELDS.has(field) ? 'field' : 'custom_field', value: field }
    } else if (typeof value === 'string') variables[key] = { type: 'static', value }
    else if (value && typeof value === 'object' && !Array.isArray(value)) variables[key] = value as DraftConfig['variables'][string]
    else throw new Error('broadcast_draft_invalid')
  }
  const parsed = draftConfigSchema.safeParse({ name: row.name, template_name: row.template_name, template_language: row.template_language ?? 'en_US',
    voice_note: row.voice_note ?? null, variables, audience_filter: row.audience_filter, scheduled_at: row.scheduled_at ?? null, create_conversations: row.create_conversations ?? false })
  if (!parsed.success) throw new Error('broadcast_draft_invalid')
  return parsed.data
}

export function storedDraftConfig(config: DraftConfig) {
  const mapping = Object.fromEntries(Object.entries(config.variables).filter(([, v]) => v.type !== 'static').map(([key, v]) => [key, v.value]))
  return { ...config, variables: undefined, template_variables: config.variables, variable_mapping: Object.keys(mapping).length ? mapping : null }
}
