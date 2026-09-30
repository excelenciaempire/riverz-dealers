import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel } from '@/types';
import type { OutboundText } from './types';

/**
 * El registro envuelve `sendText` para marcar los links, y eso lo pone en el
 * camino de TODOS los envíos: si el envoltorio pierde un método o toca algo que
 * no debe, no se rompe una pantalla — deja de salir todo.
 *
 * Se sustituye el adaptador de WhatsApp por uno de mentira para poder mirar qué
 * texto le llega al canal sin hablar con Meta.
 */

const enviados: OutboundText[] = [];
const state=vi.hoisted(() => ({ spam:false,missing:false,media:vi.fn(),template:vi.fn() }));
beforeEach(() => { state.spam=false;state.missing=false; });

vi.mock('./whatsapp/adapter', () => ({
  whatsappAdapter: {
    channel: 'whatsapp',
    label: 'WhatsApp',
    isConfigured: () => true,
    sendText: async (input: OutboundText) => {
      enviados.push(input);
      return { status: 'sent' as const };
    },
    sendMedia: async () => { state.media();return { status:'sent' as const }; },
    sendTemplate: async () => { state.template();return { status:'sent' as const }; },
    parseWebhook: async () => [],
  },
}));

vi.mock('@/lib/links/short-link', () => ({
  createShortLink: vi.fn().mockResolvedValue('AbC123xy'),
}));

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    rpc:async() => ({ data:true,error:null }),
    from:() => ({ select(){ return this; },eq(){ return this; },is(){ return this; },maybeSingle:async() => ({ data:state.missing ? null : { is_spam:state.spam },error:null }) }),
  }),
}));

const { getAdapter } = await import('./registry');

const CANALES: Channel[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'gmail',
  'outlook',
  'zoho',
  'fb_comment',
  'ig_comment',
  'mercadolibre',
  'tiktok_comment',
  'voice',
  'webchat',
];

function entrada(channel: Channel, text: string): OutboundText {
  return {
    channel,
    connection: { id: 'c', workspace_id: 'workspace-a' } as never,
    conversation: { id: 'v' } as never,
    contact: { id: 'k' } as never,
    text,
  };
}

describe('getAdapter', () => {
  it('devuelve un adaptador usable para cada canal registrado', () => {
    for (const c of CANALES) {
      const a = getAdapter(c);
      expect(a.channel).toBe(c);
      expect(typeof a.sendText).toBe('function');
      expect(typeof a.isConfigured).toBe('function');
      expect(typeof a.label).toBe('string');
    }
  });

  it('el envoltorio no se come ningun metodo opcional', () => {
    const a = getAdapter('whatsapp');
    expect(typeof a.sendMedia).toBe('function');
    expect(typeof a.sendTemplate).toBe('function');
    expect(typeof a.parseWebhook).toBe('function');
  });

  it('desconoce un canal inventado', () => {
    expect(() => getAdapter('no-existe' as Channel)).toThrow();
  });
});

describe('lo que le llega al canal', () => {
  it('blocks text, media and templates after a case is marked spam, allowing restoration',async() => {
    enviados.length=0;state.spam=true;
    const adapter=getAdapter('whatsapp'),input=entrada('whatsapp','reply');
    await expect(adapter.sendText(input)).rejects.toMatchObject({ code:'inbox_case_spam' });
    await expect(adapter.sendMedia!(input as never)).rejects.toMatchObject({ code:'inbox_case_spam' });
    await expect(adapter.sendTemplate!(input as never)).rejects.toMatchObject({ code:'inbox_case_spam' });
    expect(enviados).toHaveLength(0);expect(state.media).not.toHaveBeenCalled();expect(state.template).not.toHaveBeenCalled();
    state.spam=false;await adapter.sendText(input);await adapter.sendMedia!(input as never);await adapter.sendTemplate!(input as never);
    expect(enviados).toHaveLength(1);expect(state.media).toHaveBeenCalledTimes(1);expect(state.template).toHaveBeenCalledTimes(1);
  });
  it('fails closed if the case disappeared before the final send',async() => {
    enviados.length=0;state.missing=true;
    await expect(getAdapter('whatsapp').sendText(entrada('whatsapp','reply'))).rejects.toThrow('inbox_disposition_unavailable');
    expect(enviados).toHaveLength(0);
  });
  it('marca y acorta los links del mensaje', async () => {
    enviados.length = 0;
    await getAdapter('whatsapp').sendText(
      entrada(
        'whatsapp',
        'Miralo acá: https://tienda.com/products/remera?variant=123456789&campaign=recuperacion-septiembre',
      ),
    );
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text).toContain('https://riverz.co/r/AbC123xy');
    expect(enviados[0].text).toContain('Miralo acá:');
  });

  it('un mensaje sin links llega byte a byte igual', async () => {
    // La garantía de que esto no puede tocar la enorme mayoría de los
    // mensajes: sin "http" en el texto, la marca ni se intenta.
    enviados.length = 0;
    const texto = 'Hola, ¿cómo estás? Ya te lo despachamos 🙂';
    await getAdapter('whatsapp').sendText(entrada('whatsapp', texto));
    expect(enviados[0].text).toBe(texto);
  });

  it('no toca el resto de la entrada', async () => {
    enviados.length = 0;
    const e = entrada('whatsapp', 'https://tienda.com/p');
    e.replyToExternalId = 'wamid.123';
    e.humanAgent = true;
    await getAdapter('whatsapp').sendText(e);
    expect(enviados[0].replyToExternalId).toBe('wamid.123');
    expect(enviados[0].humanAgent).toBe(true);
    expect(enviados[0].contact).toBe(e.contact);
    expect(enviados[0].connection).toBe(e.connection);
  });
});
