import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getLogger } from '@/lib/log/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = getLogger('health')

type CheckResult = 'ok' | 'degraded' | 'down'

async function checkSupabase(): Promise<CheckResult> {
  try {
    const admin = supabaseAdmin()
    const { error } = await admin.from('contacts').select('id').limit(1)
    if (error) {
      log.warn('supabase check failed', { error: error.message })
      return 'down'
    }
    return 'ok'
  } catch (err) {
    log.warn('supabase check threw', {
      error: err instanceof Error ? err.message : String(err),
    })
    return 'down'
  }
}

async function checkWhatsapp(): Promise<CheckResult> {
  try {
    const res = await fetch('https://graph.facebook.com/v22.0/', {
      method: 'HEAD',
      signal: AbortSignal.timeout(2000),
    })
    if (res.status >= 500) return 'down'
    return 'ok'
  } catch (err) {
    log.warn('whatsapp check failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return 'degraded'
  }
}

export async function GET() {
  const [supabase, whatsapp] = await Promise.all([checkSupabase(), checkWhatsapp()])

  let status: CheckResult = 'ok'
  if (supabase === 'down') status = 'down'
  else if (supabase === 'degraded' || whatsapp === 'down' || whatsapp === 'degraded') {
    status = 'degraded'
  }

  const body = {
    status,
    checks: { supabase, whatsapp },
    ts: new Date().toISOString(),
  }

  const httpStatus = status === 'down' ? 503 : 200
  return NextResponse.json(body, {
    status: httpStatus,
    headers: { 'Cache-Control': 'no-store' },
  })
}
