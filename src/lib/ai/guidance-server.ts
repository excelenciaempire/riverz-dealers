import 'server-only'
import { NextResponse } from 'next/server'
import { inboxSession } from '@/lib/inbox/server-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
export async function guidanceSession() {
  const ctx=await inboxSession()
  if (ctx.response) return ctx
  const locale=await getLocale()
  return { ...ctx,t:(key:string) => translate(locale,`reglas.${key}`) }
}
export function guidanceError(error:{ message:string },t:(key:string) => string) {
  if (/guidance_changed|guidance_capacity/.test(error.message)) return NextResponse.json({ error:t(error.message.includes('guidance_capacity') ? 'capacity' : 'changed') },{ status:409 })
  if (error.message.includes('guidance_admin_required')) return NextResponse.json({ error:t('adminRequired') },{ status:403 })
  if (error.message.includes('subscription_read_only')) return NextResponse.json({ error:t('readOnly') },{ status:402 })
  if (/invalid_guidance_context|invalid_guidance_agent|invalid_guidance_version/.test(error.message)) return NextResponse.json({ error:t('notFound') },{ status:404 })
  if (error.message.includes('invalid_guidance_draft')) return NextResponse.json({ error:t('invalid') },{ status:400 })
  return serverError(error,t('saveFailed'))
}
