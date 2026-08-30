import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { desdeDonde, ESCALON, rangoDeEstado } from './estado-de-entrega'

/**
 * Un mensaje que salió sube: enviado → entregado → leído. Nunca baja.
 *
 * Meta manda los tres como eventos separados y el webhook los procesa en
 * paralelo, así que un `sent` que termina tarde pisaba el `delivered` que ya
 * había llegado y el mensaje se quedaba en una raya para siempre.
 */

describe('el escalón de entrega', () => {
  it('sólo deja avanzar', () => {
    // A "entregado" se llega desde enviado (o desde el optimista del compositor).
    expect(desdeDonde('delivered')).toEqual(['sending', 'sent'])
    // A "leído" se llega desde cualquiera de los anteriores.
    expect(desdeDonde('read')).toEqual(['sending', 'sent', 'delivered'])
    // A "enviado" sólo desde el optimista: un `sent` tardío no puede pisar nada.
    expect(desdeDonde('sent')).toEqual(['sending'])
  })

  it('un estado que no está en el escalón no mueve nada', () => {
    expect(desdeDonde('failed')).toEqual([])
    expect(desdeDonde('cualquier_cosa')).toEqual([])
    expect(rangoDeEstado('failed')).toBe(-1)
  })

  it('el orden es el que se lee en la burbuja', () => {
    expect([...ESCALON]).toEqual(['sent', 'delivered', 'read'])
  })
})

describe('los acuses de Meta ya no se tiran', () => {
  const messenger = readFileSync(
    join(process.cwd(), 'src', 'lib', 'channels', 'messenger', 'adapter.ts'),
    'utf8',
  )

  it('Messenger procesa entrega y lectura', () => {
    // Estaban SUSCRITOS en FB_PAGE_FIELDS y el evento caía por el `if
    // (!message)`: Riverz pagaba ese tráfico y todo lo saliente se quedaba en
    // "enviado" mientras Meta decía que había llegado y lo habían leído.
    expect(messenger).toContain('m.delivery')
    expect(messenger).toContain('m.read')
    expect(messenger).toContain('marcarEntrega')
  })

  it('sigue suscrito a los dos campos', () => {
    const graph = readFileSync(
      join(process.cwd(), 'src', 'lib', 'channels', 'meta-graph.ts'),
      'utf8',
    )
    expect(graph).toContain('message_deliveries')
    expect(graph).toContain('message_reads')
  })

  it('WhatsApp y Messenger comparten el escalón, no tienen uno cada uno', () => {
    const whatsapp = readFileSync(
      join(process.cwd(), 'src', 'lib', 'channels', 'whatsapp', 'adapter.ts'),
      'utf8',
    )
    expect(whatsapp).toContain('desdeDonde')
    expect(
      whatsapp.includes('WA_STATUS_LADDER'),
      'volvió a tener su propia copia del escalón',
    ).toBe(false)
  })
})
