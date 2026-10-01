import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboundEvent } from '../types';
import {
  captureEmailWhatsAppInquiry,
  createEmailWhatsAppLink,
  emailReferralContext,
  prepareEmailWhatsAppLinks,
  REVITALY_EMAIL_WORKSPACE,
  whatsappLinkPhone,
  whatsappPhone,
} from './whatsapp-referral';

function database(
  options: {
    ambiguous?: boolean;
    noMail?: boolean;
    foreignConversation?: boolean;
    insertError?: boolean;
  } = {}
) {
  const links: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let insert: Record<string, unknown> | undefined;
      let one = false;
      const q = {
        select: () => q,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return q;
        },
        maybeSingle: () => {
          one = true;
          return q;
        },
        single: () => {
          one = true;
          return q;
        },
        upsert: (value: Record<string, unknown>) => {
          insert = value;
          return q;
        },
        then(resolve: (v: unknown) => void) {
          if (insert) {
            if (options.insertError)
              return resolve({ data: null, error: new Error('unavailable') });
            if (
              !links.some(
                (l) =>
                  l.workspace_id === insert!.workspace_id &&
                  l.source_key === insert!.source_key
              )
            )
              links.push(insert);
            return resolve({ data: null, error: null });
          }
          let rows: Record<string, unknown>[];
          if (table === 'channel_connections') {
            const mail = filters.some(([k]) => k === 'id');
            rows = mail
              ? options.noMail
                ? []
                : [{ id: 'email', channel: 'gmail' }]
              : [
                  {
                    id: 'wa',
                    config: { display_phone_number: '+54 9 2255 62-9123' },
                  },
                ];
            if (!mail && options.ambiguous)
              rows.push({
                id: 'wa2',
                config: { display_phone_number: '+54 9 2255 62-9145' },
              });
          } else if (table === 'conversations')
            rows = options.foreignConversation ? [] : [{ id: 'conv' }];
          else
            rows = links.filter((l) => filters.every(([k, v]) => l[k] === v));
          resolve({ data: one ? (rows[0] ?? null) : rows, error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, links };
}
const creation = {
  workspaceId: REVITALY_EMAIL_WORKSPACE,
  emailConnectionId: 'email',
  sourceKey: 'guide:1:99',
  kind: 'purchase_guide' as const,
  orderId: '99',
  orderName: '#99',
};

describe('email → WhatsApp referrals', () => {
  it('uses the public production domain when no site URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    try {
      expect(await createEmailWhatsAppLink(database().db, creation)).toMatch(/^https:\/\/riverz\.co\/api\/email\/whatsapp\//);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('uses the connected phone and supports the WhatsApp URL formats', () => {
    expect(whatsappPhone({ display_phone_number: '+54 9 2255 62-9123' })).toBe(
      '5492255629123'
    );
    expect(whatsappPhone({ phone_number_id: '1234' })).toBeNull();
    expect(whatsappLinkPhone('https://wa.me/5492255629123')).toBe(
      '5492255629123'
    );
    expect(
      whatsappLinkPhone('https://api.whatsapp.com/send?phone=5492255629123')
    ).toBe('5492255629123');
    expect(
      whatsappLinkPhone('https://wa.me.evil.test/5492255629123')
    ).toBeNull();
  });
  it('reuses the source token on simultaneous retries, without leaking email addresses', async () => {
    const { db, links } = database();
    const [a, b] = await Promise.all([
      createEmailWhatsAppLink(db, creation),
      createEmailWhatsAppLink(db, creation),
    ]);
    expect(a).toBe(b);
    expect(links).toHaveLength(1);
    expect(links[0].prefill).toContain(`[RZ-${links[0].token}]`);
    expect(links[0].source_kind).toBe('purchase_guide');
    expect(a).not.toContain('#99');
    expect(a).toMatch(/\/api\/email\/whatsapp\/[a-f0-9]{24}$/);
  });
  it('keeps order-guide and general inquiry sources distinct', async () => {
    const { db, links } = database();
    const guide = await createEmailWhatsAppLink(db, creation);
    const text = await prepareEmailWhatsAppLinks(db, {
      text: 'Continúa aquí: https://wa.me/5492255629123.',
      channel: 'gmail',
      workspaceId: REVITALY_EMAIL_WORKSPACE,
      connectionId: 'email',
      conversationId: 'conv',
    });
    expect(text).not.toContain('wa.me');
    expect(text.endsWith('.')).toBe(true);
    expect(text).not.toContain(guide);
    expect(links.map((l) => l.source_kind)).toEqual([
      'purchase_guide',
      'email_inquiry',
    ]);
    expect(
      await prepareEmailWhatsAppLinks(db, {
        text,
        channel: 'gmail',
        workspaceId: REVITALY_EMAIL_WORKSPACE,
        connectionId: 'email',
        conversationId: 'conv',
      })
    ).toBe(text);
    expect(links).toHaveLength(2);
  });
  it('fails before sending if destination, mailbox, or conversation cannot be verified', async () => {
    await expect(
      createEmailWhatsAppLink(database({ ambiguous: true }).db, creation)
    ).rejects.toThrow('ambiguous');
    await expect(
      createEmailWhatsAppLink(database({ noMail: true }).db, creation)
    ).rejects.toThrow('mailbox');
    await expect(
      createEmailWhatsAppLink(database({ foreignConversation: true }).db, {
        ...creation,
        conversationId: 'foreign',
      })
    ).rejects.toThrow('scope');
    await expect(
      createEmailWhatsAppLink(database({ insertError: true }).db, creation)
    ).rejects.toThrow('unavailable');
  });
  it('does not change other merchants, WhatsApp messages, or ordinary website links', async () => {
    const db = {} as SupabaseClient;
    for (const args of [
      {
        workspaceId: 'other',
        channel: 'gmail',
        text: 'https://wa.me/5492255629123',
      },
      {
        workspaceId: REVITALY_EMAIL_WORKSPACE,
        channel: 'whatsapp',
        text: 'https://wa.me/5492255629123',
      },
      {
        workspaceId: REVITALY_EMAIL_WORKSPACE,
        channel: 'gmail',
        text: 'https://revitaly.test',
      },
    ])
      expect(await prepareEmailWhatsAppLinks(db, args)).toBe(args.text);
  });
  it('records only a live WhatsApp inbound carrying a persisted reference', async () => {
    const rpc = vi.fn(async () => ({
      data: { kind: 'email_inquiry' },
      error: null,
    }));
    const db = { rpc } as unknown as SupabaseClient;
    const event = {
      channel: 'whatsapp',
      text: 'Hola [RZ-abcdef012345abcdef012345]',
      connection: { id: 'wa', workspace_id: 'workspace' },
    } as InboundEvent;
    for (const patch of [
      { historical: true },
      { outbound: true },
      { channel: 'gmail' as const },
      { text: 'Hola' },
      { text: '[RZ-forged]' },
    ]) {
      expect(
        await captureEmailWhatsAppInquiry(db, {
          event: { ...event, ...patch },
          messageId: 'message',
          conversationId: 'conv',
        })
      ).toBeNull();
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(
      await captureEmailWhatsAppInquiry(db, {
        event,
        messageId: 'message',
        conversationId: 'conv',
      })
    ).toEqual({ kind: 'email_inquiry' });
    expect(rpc).toHaveBeenCalledWith('record_email_whatsapp_inquiry', {
      p_token: 'abcdef012345abcdef012345',
      p_workspace_id: 'workspace',
      p_connection_id: 'wa',
      p_conversation_id: 'conv',
      p_message_id: 'message',
    });
  });
  it('never treats a forwarded guide link as order identity verification', () => {
    expect(
      emailReferralContext({
        kind: 'purchase_guide',
        orderName: '#99',
        sourceConversationId: null,
        receivedAt: 'now',
      })
    ).toContain('no acredita identidad');
    expect(emailReferralContext(null)).toBeNull();
  });
});
