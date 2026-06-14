import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTextMessage, type MetaSendResult } from './meta-api'

/**
 * Tirada cuando un envío saliente apunta a un contacto que se dio de
 * baja (`contacts.opted_out = true`). El caller decide si callarla
 * (broadcasts, automations) o burbujearla a la UI (envío manual desde
 * la bandeja, donde el operador debe ver por qué no salió el texto).
 */
export class OptedOutError extends Error {
  readonly contactId: string
  constructor(contactId: string) {
    super(`Contact ${contactId} se dio de baja (opted_out=true).`)
    this.name = 'OptedOutError'
    this.contactId = contactId
  }
}

async function assertNotOptedOut(
  db: SupabaseClient,
  contactId: string,
): Promise<void> {
  const { data } = await db
    .from('contacts')
    .select('opted_out')
    .eq('id', contactId)
    .maybeSingle()
  if ((data as { opted_out?: boolean } | null)?.opted_out) {
    throw new OptedOutError(contactId)
  }
}

export interface SendTextRespectingOptOutArgs {
  db: SupabaseClient
  phoneNumberId: string
  accessToken: string
  contactId: string
  to: string
  text: string
  contextMessageId?: string
}

/**
 * Envío de texto que consulta `contacts.opted_out` antes de pegarle
 * a Meta. Si el contacto está dado de baja tira `OptedOutError` y
 * NO toca la API de Meta — así nunca cae una multa por mensaje a un
 * número que pidió STOP.
 */
export async function sendTextRespectingOptOut(
  args: SendTextRespectingOptOutArgs,
): Promise<MetaSendResult> {
  await assertNotOptedOut(args.db, args.contactId)
  return sendTextMessage({
    phoneNumberId: args.phoneNumberId,
    accessToken: args.accessToken,
    to: args.to,
    text: args.text,
    contextMessageId: args.contextMessageId,
  })
}

/**
 * Variante para callers que prefieren tragarse el opt-out (cron de
 * broadcasts, motor de automations): si el contacto está de baja
 * loguea info y devuelve `null`. Cualquier otro error sigue subiendo
 * porque indica un problema real con Meta o la config.
 */
export async function sendTextRespectingOptOutSilent(
  args: SendTextRespectingOptOutArgs,
): Promise<MetaSendResult | null> {
  try {
    return await sendTextRespectingOptOut(args)
  } catch (err) {
    if (err instanceof OptedOutError) {
      console.info(
        '[send] envío omitido por opt-out:',
        args.contactId,
      )
      return null
    }
    throw err
  }
}
