import { describe, expect, it } from 'vitest';
import { adminRewrite } from '@/lib/admin/host';
import { translate } from '@/lib/i18n/translate';
import { auditCases, brands, questions, scenarios } from './data';

describe('onboarding presentations', () => {
  it('preserves every brand URL on the admin host', () => {
    for (const brand of brands) {
      expect(adminRewrite(`/onboarding/${brand}`)).toBe(
        `/admin/onboarding/${brand}`
      );
    }
  });

  it('covers the whole journey for every brand without giving strict COD a prepayment incentive', () => {
    for (const brand of brands) {
      const relevant = scenarios.filter((s) => s.brands.includes(brand));
      expect(new Set(relevant.map((s) => s.group))).toEqual(
        new Set([0, 1, 2, 3, 4])
      );
      expect(new Set(relevant.map((s) => s.id)).size).toBe(relevant.length);
    }
    expect(scenarios.find((s) => s.id === 'benefit')?.brands).not.toContain(
      'contraentrega'
    );
    expect(scenarios.find((s) => s.id === 'collection')?.brands).toContain(
      'contraentrega'
    );
  });

  it('resolves all case paths, questions and proposals in both languages', () => {
    const keys =
      JSON.stringify({ auditCases, scenarios, questions }).match(
        /onboarding\.[A-Za-z0-9]+/g
      ) ?? [];
    expect(keys.length).toBeGreaterThan(300);
    for (const key of keys)
      for (const locale of ['es', 'en'] as const) {
        expect(translate(locale, key), `${locale}: ${key}`).not.toBe(key);
        expect(translate(locale, key)).not.toMatch(/\uFFFD/);
      }
  });
});
