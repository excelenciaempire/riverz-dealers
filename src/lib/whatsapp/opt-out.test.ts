import { describe, expect, it } from 'vitest'

import { isOptInKeyword, isOptOutKeyword, isRecoveryOptOutButton } from './opt-out'

it('honors reminder opt-outs, without treating ordinary refusals as unsubscribes', () => {
  expect(isOptOutKeyword('No más recordatorios')).toBe(true)
  expect(isOptOutKeyword('Stop reminders')).toBe(true)
  expect(isOptOutKeyword('No, gracias')).toBe(false)
  const ws='234604a9-909b-4e50-952b-acde4a85593a'
  expect(isRecoveryOptOutButton(ws,'No, gracias','button')).toBe(true)
  expect(isRecoveryOptOutButton(ws,'No, gracias','text')).toBe(false)
  expect(isRecoveryOptOutButton('another','No, gracias','button')).toBe(false)
})

describe('opt-out — el incidente', () => {
  it('no toma "Alta" dentro de una queja como pedido de alta', () => {
    // Instagram, 2026-08-29 15:02 UTC: Riverz contestó "Bienvenido nuevamente"
    // a esto y la queja se perdió, porque el handler corta el turno.
    expect(isOptInKeyword('Buen día! Alta mancha en la ropa deja el serum!!!')).toBe(false)
  })

  it('no da de baja a quien quiere cancelar un envío', () => {
    expect(isOptOutKeyword('quiero cancelar el envío, me equivoqué de dirección')).toBe(false)
    expect(isOptOutKeyword('me dieron de baja en la obra social')).toBe(false)
    expect(isOptOutKeyword('lo grabé en stop motion')).toBe(false)
  })
})

describe('opt-out — lo que sí es una baja', () => {
  it('la palabra sola, en cualquier caja', () => {
    for (const t of ['BAJA', 'baja', 'Stop', 'CANCELAR', 'unsubscribe', 'SAIR']) {
      expect(isOptOutKeyword(t)).toBe(true)
    }
  })

  it('con signos, tildes y emojis alrededor', () => {
    expect(isOptOutKeyword('  ¡Baja!  ')).toBe(true)
    expect(isOptOutKeyword('BAJA 🙏')).toBe(true)
  })

  it('con cortesía y las formas que la gente usa', () => {
    expect(isOptOutKeyword('baja por favor')).toBe(true)
    expect(isOptOutKeyword('Hola, quiero dar de baja. Gracias')).toBe(true)
    expect(isOptOutKeyword('me doy de baja')).toBe(true)
  })

  it('vacío no es nada', () => {
    expect(isOptOutKeyword('')).toBe(false)
    expect(isOptOutKeyword('   ')).toBe(false)
    expect(isOptInKeyword('')).toBe(false)
  })
})

describe('opt-in', () => {
  it('la palabra sola', () => {
    for (const t of ['ALTA', 'alta', 'SUSCRIBIR', 'subscribe', 'START']) {
      expect(isOptInKeyword(t)).toBe(true)
    }
  })

  it('con cortesía', () => {
    expect(isOptInKeyword('alta por favor')).toBe(true)
    expect(isOptInKeyword('Quiero ALTA, gracias')).toBe(true)
  })

  it('una frase que la contiene, no', () => {
    expect(isOptInKeyword('la crema me dio alta hidratación')).toBe(false)
    expect(isOptInKeyword('cuándo start el envío?')).toBe(false)
  })
})
