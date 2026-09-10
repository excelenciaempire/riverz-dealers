import { describe, expect, it } from 'vitest';
import {
  recoveryAction,
  recoveryButtonKind,
  recoveryButtonLosesToConfirmation,
  recoveryButtonReply,
  recoveryCheckoutAllowed,
  recoveryHasExistingOrder,
} from './recovery-policy';
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
    ).toBe('none');
  });

  it('trata BENEFICIO como cambio de pago cuando el pedido ya existe', () => {
    const context = {
      order_id: '7757884784938',
      financial_status: 'pending',
      payment_gateway: 'Pago Contra Entrega',
      benefit_percent: 5,
    };
    expect(recoveryHasExistingOrder(context)).toBe(true);
    const action = recoveryAction({
      assignedOnly: true,
      text: 'BENEFICIO',
      benefitPercent: context.benefit_percent,
      existingOrder: recoveryHasExistingOrder(context),
    });
    expect(action).toBe('manual_payment');
    expect(recoveryCheckoutAllowed(action)).toBe(false);
  });

  it('no interpreta un Sí genérico como solicitud de cambiar el pago', () => {
    const action = recoveryAction({
      assignedOnly: true,
      text: 'SI',
      benefitPercent: 10,
      existingOrder: true,
    });
    expect(action).toBe('none');
    expect(recoveryCheckoutAllowed(action)).toBe(false);
  });

  it('reconoce los botones contradictorios para priorizar CONFIRMAR', () => {
    expect(recoveryButtonKind('CONFIRMAR')).toBe('confirm');
    expect(recoveryButtonKind('MANTENER CONTRAENTREGA')).toBe('confirm');
    expect(recoveryButtonKind('BENEFICIO')).toBe('payment_change');
    expect(recoveryButtonKind('RECIBIR BENEFICIO')).toBe('payment_change');
    expect(recoveryButtonKind('SI')).toBeNull();
    expect(recoveryButtonKind('Necesito ayuda')).toBeNull();
    expect(
      recoveryButtonLosesToConfirmation({
        currentText: 'BENEFICIO',
        competingText: 'CONFIRMAR',
        existingOrder: true,
      })
    ).toBe(true);
    expect(
      recoveryButtonLosesToConfirmation({
        currentText: 'CONFIRMAR',
        competingText: 'BENEFICIO',
        existingOrder: true,
      })
    ).toBe(false);
    expect(
      recoveryButtonLosesToConfirmation({
        currentText: 'BENEFICIO',
        competingText: 'CONFIRMAR',
        existingOrder: false,
      })
    ).toBe(false);
  });

  it('acepta las nuevas etiquetas de la secuencia de recuperación', () => {
    expect(
      recoveryAction({
        assignedOnly: true,
        text: 'MANTENER CONTRAENTREGA',
        benefitPercent: 5,
        existingOrder: true,
      })
    ).toBe('confirm_cod');
    expect(
      recoveryAction({
        assignedOnly: true,
        text: 'RECIBIR BENEFICIO',
        benefitPercent: 5,
        existingOrder: true,
      })
    ).toBe('manual_payment');
  });

  it('responde los botones de recuperación con mensajes claros y bilingües', () => {
    expect(recoveryButtonReply('confirm', 'es')).toContain(
      'Gracias por tu compra'
    );
    expect(recoveryButtonReply('confirm', 'es')).toContain(
      'pronto será despachado'
    );
    expect(recoveryButtonReply('confirm', 'en')).toContain(
      'will be dispatched soon'
    );
    expect(recoveryButtonReply('payment_change', 'es')).toContain(
      '¿Qué método de pago prefieres?'
    );
    expect(recoveryButtonReply('payment_change', 'en')).toContain(
      'Which payment method do you prefer?'
    );
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
