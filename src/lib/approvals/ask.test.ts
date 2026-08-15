import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { askForApproval } from './ask'

/**
 * El contrato que se rompió en silencio.
 *
 * `quienDecide()` emparejaba los ids de `auth.users` contra `profiles.id`, que
 * es otra columna (el id de auth vive en `user_id`), y pedía una columna
 * `phone` que no existía. Las dos fallas juntas dejaban `destino` en null
 * SIEMPRE: la aprobación se escribía y nadie se enteraba nunca.
 *
 * Estos tests fijan las dos mitades: que se busque por `user_id` y que el
 * teléfono del dueño sea el destinatario.
 */

vi.mock('@/lib/admin/platform-whatsapp', () => ({
  platformWhatsApp: vi.fn(async () => ({
    phoneNumberId: '123',
    token: 't',
    templateName: null,
    templateLanguage: 'es',
    displayPhoneNumber: null,
  })),
}))

const enviados: Array<{ to: string; text: string }> = []
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(async (a: { to: string; text: string }) => {
    enviados.push({ to: a.to, text: a.text })
    return { messageId: 'wamid.1' }
  }),
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid.2' })),
}))

const OWNER = '11111111-1111-1111-1111-111111111111'
const WS = '22222222-2222-2222-2222-222222222222'

/** Registra con qué columna se filtró `profiles`, que es lo que se testea. */
let profilesFilter: { column: string; values: string[] } | null = null

function fakeDb(profileRows: Array<Record<string, unknown>>): SupabaseClient {
  const api = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      const self = () => chain
      Object.assign(chain, {
        select: self,
        eq: self,
        update: self,
        in(column: string, values: string[]) {
          if (table === 'profiles') profilesFilter = { column, values }
          return { data: profileRows, error: null }
        },
        maybeSingle: async () =>
          table === 'workspaces'
            ? { data: { owner_id: OWNER }, error: null }
            : { data: null, error: null },
        single: async () => ({ data: { id: 'ap-1' }, error: null }),
        insert() {
          return {
            select: () => ({
              single: async () => ({ data: { id: 'aabbcc00-0000-0000-0000-000000000000' }, error: null }),
            }),
          }
        },
      })
      // `workspace_members` se resuelve con await directo sobre la cadena.
      if (table === 'workspace_members') {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
        }
      }
      return chain
    },
  }
  return api as unknown as SupabaseClient
}

describe('askForApproval', () => {
  beforeEach(() => {
    enviados.length = 0
    profilesFilter = null
  })

  it('busca el perfil por user_id y no por id', async () => {
    await askForApproval({
      db: fakeDb([{ user_id: OWNER, phone: '5491155555555' }]),
      workspaceId: WS,
      kind: 'pago_informado',
      title: 'Pago informado',
      body: 'Dice que pagó',
    })
    expect(profilesFilter?.column).toBe('user_id')
    expect(profilesFilter?.values).toContain(OWNER)
  })

  it('le manda el aviso al teléfono del dueño, con el código para responder', async () => {
    const res = await askForApproval({
      db: fakeDb([{ user_id: OWNER, phone: '5491155555555' }]),
      workspaceId: WS,
      kind: 'pago_informado',
      title: 'Pago informado',
      body: 'Dice que pagó',
    })
    expect(res.ok).toBe(true)
    expect(res.error).toBeUndefined()
    expect(enviados).toHaveLength(1)
    expect(enviados[0].to).toBe('5491155555555')
    expect(enviados[0].text).toContain('aabbcc')
  })

  it('sin teléfono cargado deja la decisión escrita y lo dice', async () => {
    const res = await askForApproval({
      db: fakeDb([{ user_id: OWNER, phone: null }]),
      workspaceId: WS,
      kind: 'pago_informado',
      title: 'Pago informado',
      body: 'Dice que pagó',
    })
    expect(res.ok).toBe(true)
    expect(res.approvalId).toBeTruthy()
    expect(res.error).toMatch(/tel/i)
    expect(enviados).toHaveLength(0)
  })
})
