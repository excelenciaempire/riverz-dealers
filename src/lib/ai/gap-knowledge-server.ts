import 'server-only'
import { NextResponse } from 'next/server'
import { inboxSession } from '@/lib/inbox/server-context'
import { getLocale } from '@/lib/i18n/server'
import { translate } from '@/lib/i18n/translate'
import { serverError } from '@/lib/api/errors'
export const gapHeaders={ 'Cache-Control':'private, no-store' }
export async function gapSession() {
  const ctx=await inboxSession();if (ctx.response) return ctx
  const locale=await getLocale()
  return { ...ctx,locale,t:(key:string) => translate(locale,`gaps.${key}`) }
}
export function gapError(error:{ message:string },t:(key:string) => string) {
  if (/gap_changed|guidance_capacity/.test(error.message)) return NextResponse.json({ error:t('changed') },{ status:409,headers:gapHeaders })
  if (error.message.includes('gap_admin_required')) return NextResponse.json({ error:t('adminRequired') },{ status:403,headers:gapHeaders })
  if (error.message.includes('subscription_read_only')) return NextResponse.json({ error:t('readOnly') },{ status:402,headers:gapHeaders })
  if (error.message.includes('invalid_gap_context')) return NextResponse.json({ error:t('notFound') },{ status:404,headers:gapHeaders })
  return serverError(error,t('saveFailed'))
}
