import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/channels/admin-client'
import { assertCronAuth } from '@/lib/auth/cron'
import { withCronRun } from '@/lib/cron/heartbeat'
import { avisarVolumenOficial } from '@/lib/billing/volume-alerts'

async function handler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET')
  } catch (response) {
    if (response instanceof Response) return response
    throw response
  }
  try {
    return NextResponse.json({ ok: true, ...(await avisarVolumenOficial(supabaseAdmin())) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export const GET = withCronRun('billing-volume-alerts', handler)
