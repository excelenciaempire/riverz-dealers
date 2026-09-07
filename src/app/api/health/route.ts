import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getLogger } from '@/lib/log/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = getLogger('health')
const CHECK_TIMEOUT_MS = 2_000

type CheckResult = 'ok' | 'degraded' | 'down'

async function conTimeout<T>(operacion: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)
  const agotado = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error(`health check timed out after ${CHECK_TIMEOUT_MS}ms`)),
      { once: true },
    )
  })

  try {
    return await Promise.race([Promise.resolve(operacion(controller.signal)), agotado])
  } finally {
    clearTimeout(timer)
  }
}

async function checkSupabase(): Promise<CheckResult> {
  try {
    const admin = supabaseAdmin()
    const { error } = await conTimeout((signal) =>
      admin.from('contacts').select('id').limit(1).abortSignal(signal),
    )
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
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
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

  return NextResponse.json(body, {
    // Render usa esta ruta como sonda de vida del proceso. Una dependencia
    // caída debe verse en el cuerpo, pero no sacar también de circulación a
    // una instancia que sí puede responder (ni bloquear el siguiente deploy).
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
