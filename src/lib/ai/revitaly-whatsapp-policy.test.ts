import { describe, expect, it, vi } from 'vitest';
import { loadRevitalyWhatsAppPolicy, revitalyWhatsAppRedirectText } from './revitaly-whatsapp-policy';
import { simularRespuesta } from './simulacion';
const ws = '234604a9-909b-4e50-952b-acde4a85593a';
function database(options: { active?: boolean; count?: number } = {}) {
  return { from: vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'is', 'maybeSingle']) q[name] = () => q;
    q.then = (resolve: (v: unknown) => void) => resolve({ error: null, data: table === 'agent_guidance'
      ? options.active === false ? null : { id: 'rule' }
      : Array.from({ length: options.count ?? 1 }, (_, i) => ({ id: `wa${i}`, config: { display_phone_number: '+54 9 2255 62-9123' } })) });
    return q;
  }) };
}
describe('Revitaly cross-channel WhatsApp policy', () => {
  it.each(['mercadolibre', 'whatsapp', 'gmail', 'voice'])('never redirects %s through the social policy', async channel => {
    const db = database();
    expect(await loadRevitalyWhatsAppPolicy(db as never, ws, channel)).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(['instagram', 'messenger', 'webchat', 'ig_comment', 'fb_comment', 'tiktok_comment'])('uses the connected WhatsApp for %s', async channel => {
    expect(await loadRevitalyWhatsAppPolicy(database() as never, ws, channel)).toEqual({ phone: '5492255629123', displayPhone: '+54 9 2255 62-9123' });
  });
  it('leaves other merchants and disabled policies unchanged', async () => {
    const db = database();
    expect(await loadRevitalyWhatsAppPolicy(db as never, 'another', 'instagram')).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
    expect(await loadRevitalyWhatsAppPolicy(database({ active: false }) as never, ws, 'instagram')).toBeNull();
  });
  it.each([0, 2])('never selects an arbitrary WhatsApp with %s available lines', async count => {
    await expect(loadRevitalyWhatsAppPolicy(database({ count }) as never, ws, 'instagram')).rejects.toThrow('ambiguous_or_unavailable');
  });
  it('offers a short public-safe CTA in both languages without asking for personal data', () => {
    const policy = { phone: '5492255629123', displayPhone: '+54 9 2255 62-9123' };
    const es = revitalyWhatsAppRedirectText(policy, 'es', 'https://riverz.co/reference');
    const en = revitalyWhatsAppRedirectText(policy, 'en', 'https://riverz.co/reference');
    expect(es).toContain('escríbenos por WhatsApp');
    expect(en).toContain('continue your inquiry on WhatsApp');
    for (const text of [es, en]) {
      expect(text).toContain(policy.displayPhone);
      expect(text).toContain('https://riverz.co/reference');
      expect(text).not.toMatch(/DNI|calle|direcci[oó]n|comprobante|te escrib[ií]/i);
    }
  });
  it('replays an Instagram inquiry through the shared simulation path without order or model tools', async () => {
    const result = await simularRespuesta(database() as never, { id: 'natalia', workspace_id: ws,
      name: 'Natalia', language: 'es', response_mode: 'multi' } as never,
    { message: 'Quiero comprar por transferencia, ¿me das el alias?', simulatedChannel: 'instagram', historial: [] });
    expect(result.reply).toContain('+54 9 2255 62-9123');
    expect(result.reply).toContain('escríbenos por WhatsApp');
    expect(result.reply).not.toContain('Alias:');
    expect(result.herramientas).toEqual([]);
    expect(result.usage).toMatchObject({ input_tokens: 0, output_tokens: 0 });
  });
});
