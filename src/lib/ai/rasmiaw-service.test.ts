import { describe, expect, it } from 'vitest';
import { recoveryAction, recoveryCheckoutAllowed } from './recovery-policy';
import { señalDura } from './escalada';
import { publicReplyFrom } from '@/lib/instagram-agent/realtime';
import { heuristicDmDecision } from '@/lib/instagram-agent/dm-opportunity';

describe('escenarios sintéticos de Rasmiaw', () => {
  it('solo habilita cupón y checkout cuando la etapa lo autorizó', () => {
    expect(
      recoveryAction({
        assignedOnly: true,
        text: 'CONFIRMAR',
        benefitPercent: 5,
      })
    ).toBe('confirm_cod');
    expect(recoveryCheckoutAllowed('confirm_cod')).toBe(false);
    expect(
      recoveryAction({
        assignedOnly: true,
        text: 'BENEFICIO',
        benefitPercent: 5,
      })
    ).toBe('benefit');
    expect(recoveryCheckoutAllowed('benefit')).toBe(true);
    expect(
      recoveryAction({ assignedOnly: true, text: 'SI', benefitPercent: 5 })
    ).toBe('none');
    expect(
      recoveryAction({ assignedOnly: true, text: 'SI', benefitPercent: 10 })
    ).toBe('benefit');
  });

  it('manda transferencias y comprobantes a revisión humana', () => {
    expect(
      recoveryAction({
        assignedOnly: true,
        text: 'Quiero pagar por transferencia',
        benefitPercent: 5,
      })
    ).toBe('manual_payment');
    expect(señalDura('Te adjunto el comprobante de Bancolombia')?.clase).toBe(
      'cobro'
    );
  });

  it('detecta los casos de posventa que no pueden quedar en automático', () => {
    expect(
      señalDura('La guía dice entregado pero yo no recibí nada')?.clase
    ).toBe('no_llego');
    expect(señalDura('El envío va para otra ciudad')?.clase).toBe('envio_mal');
    expect(señalDura('Quiero cancelar mi pedido')?.clase).toBe('devolucion');
    expect(señalDura('Esto es una estafa, voy a denunciar')?.clase).toBe(
      'legal'
    );
  });

  it('no publica información privada de pedidos o reclamos', () => {
    const reply = 'Tu guía es 123456 y llega a la dirección registrada.';
    expect(heuristicDmDecision('¿Dónde está mi pedido?', reply).reason).toBe(
      'pedido'
    );
    expect(publicReplyFrom(reply, true, { reason: 'pedido' })).toBe(
      'Te escribí por privado para revisarlo contigo 💬'
    );
    expect(
      publicReplyFrom('El rascador mide 42 cm.', false, { reason: 'ninguna' })
    ).toContain('42 cm');
  });
});
