/*
 * Clears only the false answer-gap escalations produced by the historical
 * public-comment run. Real order, payment and complaint cases use different
 * reasons/summaries and are deliberately left untouched.
 */
import 'dotenv/config'

import { supabaseAdmin } from '@/lib/channels/admin-client'

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23'
const FALSE_SUMMARIES = [
  'No se pudo verificar el precio vigente antes de responder:',
  'La IA intentó publicar un precio no verificado',
]

async function main() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('conversations')
    .select('id, needs_human_summary')
    .eq('workspace_id', WORKSPACE_ID)
    .in('channel', ['ig_comment', 'fb_comment'])
    .eq('needs_human_reason', 'answer_gap')
    .not('needs_human_at', 'is', null)
  if (error) throw error

  const falseEscalations = (data ?? []).filter((row) =>
    FALSE_SUMMARIES.some((prefix) => String(row.needs_human_summary ?? '').startsWith(prefix)),
  )
  if (falseEscalations.length === 0) {
    console.log(JSON.stringify({ ok: true, repaired: 0, audit: 'historical_comment_answer_gap_repair' }))
    return
  }

  const { error: updateError } = await db
    .from('conversations')
    .update({
      needs_human_at: null,
      needs_human_reason: null,
      needs_human_summary: null,
      needs_human_visto_at: new Date().toISOString(),
    })
    .in('id', falseEscalations.map((row) => row.id))
  if (updateError) throw updateError
  console.log(JSON.stringify({
    ok: true,
    repaired: falseEscalations.length,
    ids: falseEscalations.map((row) => row.id),
    audit: 'historical_comment_answer_gap_repair',
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
