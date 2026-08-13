import { describe, it, expect } from 'vitest'
import {
  reasonBucket,
  shouldContact,
  normalizeRejectedPayment,
  statusOf,
} from './rejected'

describe('reasonBucket', () => {
  it('manda a riesgo lo que es fraude, no venta perdida', () => {
    expect(reasonBucket('cc_rejected_high_risk')).toBe('risk')
    expect(reasonBucket('rejected_high_risk')).toBe('risk')
    expect(reasonBucket('cc_rejected_blacklist')).toBe('risk')
    expect(reasonBucket('cc_rejected_max_attempts')).toBe('risk')
    for (const d of [
      'cc_rejected_high_risk',
      'rejected_high_risk',
      'cc_rejected_blacklist',
      'cc_rejected_max_attempts',
    ]) {
      expect(shouldContact(reasonBucket(d))).toBe(false)
    }
  })

  it('separa datos mal cargados, fondos y banco', () => {
    expect(reasonBucket('cc_rejected_bad_filled_security_code')).toBe('retry')
    expect(reasonBucket('cc_rejected_bad_filled_date')).toBe('retry')
    expect(reasonBucket('cc_rejected_invalid_installments')).toBe('retry')
    expect(reasonBucket('cc_rejected_insufficient_amount')).toBe('funds')
    expect(reasonBucket('cc_rejected_call_for_authorize')).toBe('bank')
    expect(reasonBucket('rejected_by_bank')).toBe('bank')
    expect(reasonBucket('cc_rejected_card_disabled')).toBe('bank')
  })

  it('un motivo desconocido cae en other y SÍ se contacta', () => {
    // La hoja ya mostró motivos fuera del mapa (invalid_account,
    // cc_rejected_card_type_not_allowed). Un motivo nuevo de MP no puede
    // frenar la recuperación: solo el riesgo explícito lo hace.
    expect(reasonBucket('un_motivo_que_no_existe')).toBe('other')
    expect(shouldContact(reasonBucket('un_motivo_que_no_existe'))).toBe(true)
    expect(reasonBucket(null)).toBe('other')
    expect(reasonBucket('')).toBe('other')
  })
})

describe('normalizeRejectedPayment', () => {
  const base = {
    external_key: '123',
    rejected_at: '2026-08-10T14:03:00.000Z',
  }

  it('normaliza los formatos de teléfono que trae la hoja', () => {
    // Tal cual aparecen en "Pagos Rechazados": local sin código de país,
    // con 0 de larga distancia, y ya internacional pero sin el 9.
    // En los cuatro casos el resultado tiene que llevar el 9 argentino, que
    // es lo único que hace alcanzable a un móvil desde WhatsApp.
    const cases: Array<[string, string]> = [
      ['1144960458', '5491144960458'],
      ['02227547762', '5492227547762'],
      ['3516501221', '5493516501221'],
      ['543489454730', '5493489454730'],
      // Ya viene con el 9: no se le agrega otro.
      ['5491144960458', '5491144960458'],
    ]
    for (const [raw, expected] of cases) {
      const out = normalizeRejectedPayment({ ...base, phone: raw }, 'AR')
      expect(out?.phone, `teléfono ${raw}`).toBe(expected)
    }
  })

  it('deja el teléfono en null cuando no da un número válido', () => {
    // Mejor sin teléfono (queda "sin_telefono" en la hoja) que intentar un
    // envío que Meta rechaza y ensucia la salud del número.
    expect(normalizeRejectedPayment({ ...base, phone: '123' }, 'AR')?.phone).toBeNull()
    expect(normalizeRejectedPayment({ ...base, phone: '' }, 'AR')?.phone).toBeNull()
    expect(normalizeRejectedPayment({ ...base, phone: null }, 'AR')?.phone).toBeNull()
  })

  it('descarta filas sin clave o con fecha inválida', () => {
    expect(normalizeRejectedPayment({ ...base, external_key: '' }, 'AR')).toBeNull()
    expect(
      normalizeRejectedPayment({ external_key: '1', rejected_at: 'ayer' }, 'AR'),
    ).toBeNull()
  })

  it('rechaza montos con separador de miles en vez de adivinarlos', () => {
    // "$39.990" es 39990 en Argentina y 39.99 en Estados Unidos. Adivinar
    // mal mete un factor 1000 en el monto que va en el mensaje al cliente,
    // así que se descarta.
    expect(normalizeRejectedPayment({ ...base, amount: '$39.990' }, 'AR')?.amount).toBeNull()
    expect(normalizeRejectedPayment({ ...base, amount: '1.234.567' }, 'AR')?.amount).toBeNull()
    // Lo inequívoco sí pasa.
    expect(normalizeRejectedPayment({ ...base, amount: 39990 }, 'AR')?.amount).toBe(39990)
    expect(normalizeRejectedPayment({ ...base, amount: '39990' }, 'AR')?.amount).toBe(39990)
    expect(normalizeRejectedPayment({ ...base, amount: '39990.50' }, 'AR')?.amount).toBe(39990.5)
    expect(normalizeRejectedPayment({ ...base, amount: '$ 39990' }, 'AR')?.amount).toBe(39990)
  })

  it('limpia correo e intentos', () => {
    const out = normalizeRejectedPayment(
      {
        ...base,
        amount: 39990,
        email: '  Cliente@Ejemplo.COM ',
        attempts: 0,
        status_detail: 'cc_rejected_insufficient_amount',
      },
      'AR',
    )
    expect(out?.amount).toBe(39990)
    expect(out?.email).toBe('cliente@ejemplo.com')
    // Nunca menos de 1: si la fila existe, hubo al menos un intento.
    expect(out?.attempts).toBe(1)
    expect(out?.reason_bucket).toBe('funds')
  })

  it('ignora un correo que no es correo', () => {
    expect(normalizeRejectedPayment({ ...base, email: 'sin-arroba' }, 'AR')?.email).toBeNull()
  })
})

describe('statusOf', () => {
  const row = {
    phone: '5491144960458',
    contacted_at: null as string | null,
    recovered_at: null as string | null,
    skip_reason: null as string | null,
    last_error: null as string | null,
  }

  it('recuperado gana sobre contactado', () => {
    expect(statusOf({ ...row, contacted_at: 'x', recovered_at: 'y' })).toBe('recuperado')
  })

  it('sin teléfono se distingue de omitido', () => {
    expect(statusOf({ ...row, phone: null })).toBe('sin_telefono')
    expect(statusOf({ ...row, skip_reason: 'risk' })).toBe('omitido')
  })

  it('pendiente cuando todavía no pasó nada', () => {
    expect(statusOf(row)).toBe('pendiente')
  })
})
