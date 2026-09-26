import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection } from '@/types';
import {
  claimMessageBody,
  closeResolvedClaimConversation,
} from './claims-poll';

function mockDb() {
  const result = { error: null };
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn().mockResolvedValue(result),
  };
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return {
    db: { from } as unknown as SupabaseClient,
    from,
    query,
  };
}

const connection = {
  id: 'connection-1',
  workspace_id: 'workspace-1',
} as ChannelConnection;

describe('Mercado Libre claim conversation state', () => {
  it('closes the matching Riverz thread when Mercado Libre closes the claim', async () => {
    const { db, from, query } = mockDb();

    await closeResolvedClaimConversation(db, connection, {
      id: 5572056476,
      status: 'closed',
      last_updated: '2026-09-05T20:13:36.000Z',
      resolution: {
        reason: 'payment_refunded',
        date_created: '2026-09-05T20:13:36.000Z',
      },
    });

    expect(from).toHaveBeenCalledWith('conversations');
    expect(query.update).toHaveBeenCalledWith({
      status: 'closed',
      closed_at: '2026-09-05T20:13:36.000Z',
    });
    expect(query.eq).toHaveBeenNthCalledWith(1, 'workspace_id', 'workspace-1');
    expect(query.eq).toHaveBeenNthCalledWith(
      2,
      'connection_id',
      'connection-1'
    );
    expect(query.eq).toHaveBeenNthCalledWith(
      3,
      'thread_external_id',
      'claim:5572056476'
    );
    expect(query.neq).toHaveBeenCalledWith('status', 'closed');
  });

  it('leaves the Riverz thread alone while the claim remains open', async () => {
    const { db, from } = mockDb();

    await closeResolvedClaimConversation(db, connection, {
      id: 5572056476,
      status: 'opened',
    });

    expect(from).not.toHaveBeenCalled();
  });
});

describe('Mercado Libre claim message body', () => {
  it('turns the HTML its team writes into text and keeps the original', () => {
    const html =
      '<p dir="ltr"><span style="white-space: pre-wrap;">Hola, equipo.</span></p><p><br></p>' +
      '<p dir="ltr"><span style="white-space: pre-wrap;">Envía la factura antes del </span>' +
      '<b><strong class="coco-editor-textBold" style="white-space: pre-wrap;">29/09</strong></b>' +
      '<span style="white-space: pre-wrap;">. Sigue este </span>' +
      '<a href="https://vendedores.mercadolibre.com.ar/nota/facturar?a=1&amp;b=2"><span style="white-space: pre-wrap;">paso a paso</span></a>' +
      '<span style="white-space: pre-wrap;">.</span></p>' +
      '<p><span style="white-space: pre-wrap;">&nbsp;</span></p>' +
      '<p dir="ltr"><b><strong class="coco-editor-textBold" style="white-space: pre-wrap;">Daniela.</strong></b></p>' +
      '<p><a href="https://www.mercadolibre.com.mx/"><span style="white-space: pre-wrap;">Mercado Libre</span></a>' +
      '<span style="white-space: pre-wrap;">&nbsp;|&nbsp;</span>' +
      '<a href="https://www.mercadopago.com.mx/"><span style="white-space: pre-wrap;">Mercado Pago</span></a></p>';

    expect(claimMessageBody(html)).toEqual({
      text: [
        'Hola, equipo.',
        '',
        'Envía la factura antes del 29/09. Sigue este paso a paso (https://vendedores.mercadolibre.com.ar/nota/facturar?a=1&b=2).',
        '',
        'Daniela.',
        '',
        'Mercado Libre | Mercado Pago',
      ].join('\n'),
      html,
    });
  });

  it('decodes the entities of its template messages', () => {
    const html =
      '<p dir="ltr">Hola, Tienda.</p>\n' +
      '<p dir="ltr">Tu comprador no recibi&oacute; el producto.</p>\n' +
      '<p>&iexcl;&Eacute;xito en tus ventas!</p>';

    expect(claimMessageBody(html).text).toBe(
      'Hola, Tienda.\n\nTu comprador no recibió el producto.\n\n¡Éxito en tus ventas!',
    );
  });

  it('does not repeat a link that already shows where it goes', () => {
    const html =
      '<p><a href="https://www.mercadolibre.com.ar/ayuda/23050">www.mercadolibre.com.ar/ayuda/23050</a></p>';

    expect(claimMessageBody(html).text).toBe(
      'www.mercadolibre.com.ar/ayuda/23050',
    );
  });

  it('leaves what the buyer and the seller write as it is', () => {
    const text = 'Hola <3\n\nya lo envié, llega en <48 h';

    expect(claimMessageBody(`  ${text}  `)).toEqual({ text });
  });
});
