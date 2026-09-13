import { describe, it, expect } from 'vitest';
import { confirmationCopy, confirmationDisplayVars } from './confirmation-copy';
import { buildTemplateComponents } from '@/lib/whatsapp/template-components';
describe('confirmation copy', () => {
  it('keeps authoritative amounts and formats whole COP amounts without decimals', () => {
    const vars = { recipient_name: 'Maryuri Laverde', total_price: '110000.00', currency: 'COP' };
    expect(confirmationDisplayVars(vars, 'es')).toEqual({ recipient_first_name: 'Maryuri', total_price_display: '110.000 COP' });
    expect(vars.total_price).toBe('110000.00');
    expect(confirmationDisplayVars(vars, 'en').total_price_display).toBe('110,000 COP');
  });
  it('does not guess a missing currency or parse localized money incorrectly', () => {
    expect(confirmationDisplayVars({ total_price: '110.000,00', currency: 'COP' }, 'es').total_price_display).toBe('110.000,00 COP');
    expect(confirmationDisplayVars({ total_price: '110000.00' }, 'es').total_price_display).toBe('110000.00');
  });
  it.each(['es', 'en'] as const)('provides complete non-promissory templates in %s', lang => {
    for (const item of confirmationCopy(lang)) {
      expect(buildTemplateComponents({ category: 'UTILITY', headerType: 'none', bodyText: item.body,
        buttons: item.buttons, bodySamples: item.samples }).error).toBeNull();
      expect(item.body).not.toMatch(/DeUNA|despacharemos|ya está en camino|discount/i);
      const indices = [...item.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
      expect([...new Set(indices)].sort((a,b)=>a-b)).toEqual(item.fields.map((_,i)=>i+1));
      expect(item.samples).toHaveLength(item.fields.length);
      expect(item.buttons).toHaveLength(2);
    }
  });
});
