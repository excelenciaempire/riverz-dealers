import { expect, it } from 'vitest';
import { revitalyEmailRedirect, revitalyFeedbackBrief, ensureRevitalyIntroduction } from './revitaly-channel-policy';
it('adds the missing introduction only on a first private reply, in both languages', () => {
  const opts = { workspaceId: '234604a9-909b-4e50-952b-acde4a85593a', channel: 'whatsapp' as const, language: 'es', text: 'Perfecto!', hasPriorReply: false };
  expect(ensureRevitalyIntroduction(opts)).toContain('Te habla Natalia');
  expect(ensureRevitalyIntroduction({...opts, language:'en'})).toContain('This is Natalia');
  for (const change of [{hasPriorReply:true}, {workspaceId:'other'}, {channel:'gmail' as const}, {channel:'ig_comment' as const}, {text:'Soy Natalia'}])
    expect(ensureRevitalyIntroduction({...opts,...change})).toBe(change.text ?? opts.text);
});
it('distinguishes delivery-cost questions and cash-on-delivery without changing other merchants', () => {
  const ws='234604a9-909b-4e50-952b-acde4a85593a';
  expect(revitalyFeedbackBrief(ws,'¿Cuánto cuesta el envío?')).toContain('no presentes precios');
  expect(revitalyFeedbackBrief(ws,'¿Puedo pagar contra entrega?')).toContain('únicamente Mercado Libre');
  expect(revitalyFeedbackBrief('other','¿Puedo pagar contra entrega?')).toBe('');
});
it('redirects every Revitaly email, without affecting WhatsApp, social DMs or another account', () => {
  const ws = '234604a9-909b-4e50-952b-acde4a85593a';
  for (const c of ['gmail', 'outlook'] as const)
    expect(revitalyEmailRedirect(ws, c)).toContain(
      'https://wa.me/5492255629123'
    );
  for (const c of [
    'whatsapp',
    'instagram',
    'messenger',
    'mercadolibre',
  ] as const)
    expect(revitalyEmailRedirect(ws, c)).toBeNull();
  expect(revitalyEmailRedirect('another', 'gmail')).toBeNull();
  expect(revitalyEmailRedirect(ws, 'gmail', 'en')).toContain(
    'Please continue here'
  );
});
