import { expect, it } from 'vitest';
import { revitalyEmailRedirect } from './revitaly-channel-policy';
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
