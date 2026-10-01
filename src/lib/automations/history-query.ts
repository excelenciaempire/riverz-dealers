import { z } from 'zod'

const timestamp = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)))
const cursorSchema = z.object({ created_at: timestamp, id: z.string().uuid() }).strict()

export const automationHistorySchema = z.object({
  status: z.enum(['success', 'partial', 'failed']).optional(),
  contact_id: z.string().uuid().optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  cursor: z.string().max(512).optional(),
  log: z.string().uuid().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
    ctx.addIssue({ code: 'custom', message: 'automation_history_invalid' })
  }
})

export type AutomationHistoryQuery = z.infer<typeof automationHistorySchema>

/** JSON is URL-encoded by URLSearchParams. Preserve Postgres microseconds. */
export function historyCursor(row: { created_at: string; id: string }): string {
  return JSON.stringify(cursorSchema.parse({ created_at: row.created_at, id: row.id }))
}

export function readHistoryCursor(value: string) {
  try { return cursorSchema.parse(JSON.parse(value)) }
  catch { throw new Error('automation_history_invalid') }
}

export function parseHistoryQuery(value: unknown): AutomationHistoryQuery {
  const result = automationHistorySchema.safeParse(value)
  if (!result.success) throw new Error('automation_history_invalid')
  if (result.data.cursor) readHistoryCursor(result.data.cursor)
  return result.data
}

export const automationHistoryId = z.union([z.string().uuid(), z.string().regex(/^[a-f0-9]{8}$/i)])
