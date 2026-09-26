/* eslint-disable @typescript-eslint/no-explicit-any -- doble de Supabase en memoria */
import { describe, expect, it } from 'vitest'
import { productoUnicoAsignado } from './runner'
import type { AiAgent } from './types'

function db(tablas: Record<string, any[]>) {
  return {
    from: (tabla: string) => {
      const filtros: Array<(r: any) => boolean> = []
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => { filtros.push((r) => r[k] === v); return q },
        in: (k: string, vs: any[]) => { filtros.push((r) => vs.includes(r[k])); return q },
        then: (res: any, rej: any) =>
          Promise.resolve({ data: (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r))), error: null }).then(res, rej),
      }
      return q
    },
  } as any
}

const productos = [
  { id: 'shampoo', workspace_id: 'w', master_id: null },
  { id: 'ml-x1', workspace_id: 'w', master_id: 'shampoo' },
  { id: 'ml-x3', workspace_id: 'w', master_id: 'shampoo' },
  { id: 'guia', workspace_id: 'w', master_id: null },
]

const agente = (over: Partial<AiAgent>) => ({ id: 'a1', workspace_id: 'w', product_scope: 'specific', ...over }) as AiAgent

describe('productoUnicoAsignado', () => {
  it('un asistente de un solo producto sabe de cuál le hablan aunque no lo nombren', async () => {
    const d = db({ shopify_products: productos, ai_agent_products: [{ agent_id: 'a1', product_id: 'shampoo' }] })
    await expect(productoUnicoAsignado(d, agente({}), 'w')).resolves.toMatchObject({
      product_id: 'shampoo',
      confidence: 'high',
      via: 'asignado',
    })
  })

  it('con dos productos distintos no adivina', async () => {
    const d = db({
      shopify_products: productos,
      ai_agent_products: [
        { agent_id: 'a1', product_id: 'shampoo' },
        { agent_id: 'a1', product_id: 'guia' },
      ],
    })
    await expect(productoUnicoAsignado(d, agente({}), 'w')).resolves.toBeNull()
  })

  it('con el catálogo entero tampoco', async () => {
    const d = db({ shopify_products: productos, ai_agent_products: [] })
    await expect(productoUnicoAsignado(d, agente({ product_scope: 'all' }), 'w')).resolves.toBeNull()
  })
})
