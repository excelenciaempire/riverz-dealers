import { describe, expect, it } from 'vitest'
import { assertTemplateIntent } from './template-intent-guard'

describe('assertTemplateIntent', () => {
  it('blocks the correction that was incorrectly placed in a dispatch template', () => {
    expect(() => assertTemplateIntent('deuna_despachado_producto_v2', [
      'El aviso de cancelación anterior fue un error del sistema. Tu pedido sigue activo.',
      '114015579121',
    ])).toThrow('template_intent_mismatch')
  })

  it('blocks a correction even if it starts with a product line', () => {
    expect(() => assertTemplateIntent('deuna_despachado_producto_v2', [
      '2 × Puma Suede XL. El mensaje anterior de cancelación fue un error del sistema.',
      '114015579121',
    ])).toThrow('template_intent_mismatch')
  })

  it('allows the actual dispatch notice with items and tracking', () => {
    expect(() => assertTemplateIntent('deuna_despachado_producto_v2', [
      '1 × Puma Suede XL (Negro / 39) · 1 × Puma Suede XL (Negro con blanco / 39)',
      '114015579121',
    ])).not.toThrow()
  })

  it('does not change other templates', () => {
    expect(() => assertTemplateIntent('deuna_recordatorio_tracking_v1', [
      'El aviso de cancelación fue un error del sistema.',
    ])).not.toThrow()
  })
})
