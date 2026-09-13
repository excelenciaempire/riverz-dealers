import { describe, expect, it } from 'vitest';
import {
  publicVoiceContext,
  voiceExecutionMeta,
  withVoiceExecutionMeta,
} from './execution-context';

describe('contexto global de una llamada', () => {
  it('conserva el origen sin exponer ids internos al modelo', () => {
    const context = withVoiceExecutionMeta(
      { order_number: '#1042', shipping_city: 'Medellín' },
      {
        origin: 'assistant',
        assistantId: 'assistant-1',
        conversationId: 'conversation-1',
      }
    );

    expect(voiceExecutionMeta(context)).toEqual({
      origin: 'assistant',
      assistantId: 'assistant-1',
      conversationId: 'conversation-1',
    });
    expect(publicVoiceContext(context)).toEqual({
      order_number: '#1042',
      shipping_city: 'Medellín',
    });
  });

  it('oculta controles operativos pero conserva las variables del negocio', () => {
    expect(
      publicVoiceContext({
        campaign_id: 'campaign-1',
        test_call: true,
        escalated_by_ai: true,
        capacity_requeues: 2,
        skip_if_replied: true,
        cod_writeback: false,
        product_name: 'Serum',
      })
    ).toEqual({ product_name: 'Serum' });
  });
});
