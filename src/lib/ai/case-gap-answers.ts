import { z } from 'zod'

/** A case answer is never a business policy or a customer send. */
export const caseGapAnswerInput = z.object({
  id: z.string().uuid(),
  gap_id: z.string().uuid(),
  expected_revision: z.number().int().min(0).max(1000000),
  answer: z.string().trim().min(2).max(2000),
}).strict()

export type CaseGapAnswer = {
  gap_id: string
  question: string
  missing: string | null
  created_at: string
  answer: string | null
  revision: number
  answered_at: string | null
  answered_by: string | null
  resolved_at: string | null
}
