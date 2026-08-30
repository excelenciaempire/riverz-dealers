import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * "Leé mi marca" pedía una cuenta que el navegador no manda.
 *
 * Es el único atajo que llena solo la persona y el conocimiento del agente, y
 * el asistente de alta lo llamaba con `{ url }` a secas. La ruta exigía
 * `workspace_id` en el cuerpo y cortaba con 400 SIEMPRE: todo comercio nuevo
 * que pasó por ese paso vio un error genérico, apretó "omitir" y terminó con
 * un agente de persona vacía.
 */

const consultas: string[] = []

function tabla(nombre: string, fila: unknown) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      consultas.push(nombre)
      return { data: fila, error: null }
    },
    then: (ok: (v: unknown) => unknown) => {
      consultas.push(nombre)
      return Promise.resolve({ data: fila ? [fila] : [], error: null }).then(ok)
    },
  }
  return chain
}

let esDuenio = true

vi.mock('@/lib/channels/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (t: string) =>
      t === 'workspaces'
        ? tabla('workspaces', esDuenio ? { id: 'ws1' } : null)
        : t === 'workspace_members'
          ? tabla('workspace_members', null)
          : tabla(t, null),
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
  }),
}))
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'es' }))
vi.mock('@/lib/csrf', () => ({ csrfGuard: async () => null }))
vi.mock('@/lib/ai/rate-limit', () => ({ aiBudgetGuard: async () => null }))


import { POST } from './route'

const pedir = (body: unknown) =>
  POST(
    new Request('https://riverz.co/api/ai/agents/generate-from-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  consultas.length = 0
  esDuenio = true
})

describe('generate-from-url: de quién es la cuenta', () => {
  it('sin url no hay nada que leer', async () => {
    expect((await pedir({})).status).toBe(400)
  })

  it('sin workspace_id NO corta: lo resuelve el servidor', async () => {
    const r = await pedir({ url: 'https://ejemplo.com' })
    // Lo que sigue es el crawler, que aca no corre: lo unico que importa es
    // que la puerta no lo haya frenado antes de llegar.
    expect(r.status).not.toBe(400)
    expect(r.status).not.toBe(403)
    // Y lo resolvió mirando de quién es la cuenta, no adivinando.
    expect(consultas).toContain('workspaces')
  })

  it('quien no tiene cuenta sigue afuera', async () => {
    esDuenio = false
    expect((await pedir({ url: 'https://ejemplo.com' })).status).toBe(400)
  })
})
