import { describe, expect, it } from 'vitest'
import { problemaDelTexto } from './tablero'

describe('problemaDelTexto', () => {
  const antes = 'Hola {{1}}, tu pedido {{2}} ya salió.'

  it('acepta otro texto con las mismas variables', () => {
    expect(problemaDelTexto('Hola {{1}}! Tu pedido {{2}} va en camino 🚚', antes)).toBeNull()
  })

  it('no deja sacar ni agregar variables', () => {
    expect(problemaDelTexto('Hola {{1}}, ya salió.', antes)).toBe('tableroVariablesCambiadas')
    expect(problemaDelTexto('Hola {{1}}, tu pedido {{2}} por {{3}} ya salió.', antes)).toBe('tableroVariablesCambiadas')
  })

  it('no deja empezar ni terminar con una variable', () => {
    expect(problemaDelTexto('{{1}}, tu pedido {{2}} ya salió.', antes)).toBe('tableroBordeVariable')
    expect(problemaDelTexto('Hola {{1}}, tu pedido es {{2}}', antes)).toBe('tableroBordeVariable')
  })

  it('respeta el largo de Meta', () => {
    expect(problemaDelTexto(`Hola {{1}}, tu pedido {{2}} ${'x'.repeat(1100)}.`, antes)).toBe('tableroMuyLargo')
  })
})
