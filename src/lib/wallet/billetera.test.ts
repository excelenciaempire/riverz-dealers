import { describe, expect, it } from 'vitest'
import { centavosDe, type Tarifa } from './tarifas'
import { rangoDe } from './movimientos'
import { puedeGastar, type Billetera } from './saldo'

const tarifa = (precioMilicentavos: number, unidad = 'respuesta'): Tarifa => ({
  concepto: 'x',
  nombreEs: 'X',
  nombreEn: 'X',
  unidad,
  precioMilicentavos,
  activo: true,
  orden: 1,
})

const billetera = (over: Partial<Billetera> = {}): Billetera => ({
  workspaceId: 'ws-1',
  saldoCentavos: 1000,
  moneda: 'usd',
  descubiertoCentavos: 200,
  bloquearSinSaldo: true,
  autoRecargaCentavos: null,
  autoUmbralCentavos: null,
  ...over,
})

describe('cuánto se cobra por un consumo', () => {
  it('una respuesta a 2 centavos son 2 centavos', () => {
    expect(centavosDe(tarifa(2000), 1)).toBe(2)
  })

  it('2,4 minutos a 20 centavos el minuto son 48', () => {
    expect(centavosDe(tarifa(20_000, 'minuto'), 2.4)).toBe(48)
  })

  it('un consumo real nunca cuesta cero', () => {
    // Un movimiento de 0 no le dice nada a nadie y ensucia el libro. El piso es
    // 1 centavo aunque la tarifa dé menos.
    expect(centavosDe(tarifa(100), 0.5)).toBe(1)
  })

  it('cantidad cero no cobra nada', () => {
    expect(centavosDe(tarifa(2000), 0)).toBe(0)
  })
})

describe('quién puede gastar', () => {
  it('con saldo, sí', () => {
    expect(puedeGastar(billetera())).toBe(true)
  })

  it('sin saldo y con bloqueo, no', () => {
    expect(puedeGastar(billetera({ saldoCentavos: -200 }))).toBe(false)
  })

  it('dentro del descubierto todavía sí: una llamada en curso no se corta por tres centavos', () => {
    expect(puedeGastar(billetera({ saldoCentavos: -50 }))).toBe(true)
  })

  it('sin bloqueo, siempre sí — aunque el saldo esté en rojo', () => {
    // Es como nace la billetera: estrenarla no puede dejar mudo a nadie.
    expect(
      puedeGastar(billetera({ saldoCentavos: -100_000, bloquearSinSaldo: false })),
    ).toBe(true)
  })
})

describe('el rango que pide la pantalla', () => {
  it('sin nada, los últimos 30 días', () => {
    const r = rangoDe(null, null)
    const dias = (Date.parse(r.hasta) - Date.parse(r.desde)) / (24 * 60 * 60 * 1000)
    expect(Math.round(dias)).toBe(30)
  })

  it('una fecha inventada no se arrastra a la consulta', () => {
    const r = rangoDe('no soy una fecha', null)
    expect(Number.isFinite(Date.parse(r.desde))).toBe(true)
    expect(Number.isFinite(Date.parse(r.hasta))).toBe(true)
  })

  it('al revés se endereza', () => {
    const r = rangoDe('2026-08-20T00:00:00Z', '2026-08-10T00:00:00Z')
    expect(Date.parse(r.desde)).toBeLessThan(Date.parse(r.hasta))
  })
})
