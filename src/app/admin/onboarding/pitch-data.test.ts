import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import {
  currentCases,
  isCaseEnabled,
  parseDraft,
  proposedCases,
  renderMessage,
  safeWebsite,
  templatesForCase,
  type PitchDraft,
} from './pitch-data';
import { originals } from './original-templates';
const draft: PitchDraft = {
  version: 1,
  brand: 'pilar',
  name: 'Pilar',
  site: 'https://pilarargentina.store',
  product: 'Serum Pilar',
  customer: 'María',
  amount: '[importe]',
  order: '#1042',
  model: 'prepaid',
  features: {
    cart: true,
    discount: false,
    comments: true,
    aftercare: true,
    voice: false,
  },
  discount: 0,
  excluded: [],
  edits: {},
  answers: {},
  owner: '',
  monthly: '',
  launch: '',
  reviewed: false,
};

describe('client pitch', () => {
  it('shows the actual active cart template, not a draft or a newer unused template', () => {
    const c = currentCases('pilar').find((c) => c.id === 'audit-7')!;
    const templates = templatesForCase('pilar', c);
    expect(templates.map((t) => t.name)).toEqual(['carrito_abandonado_2']);
    expect(templates[0].body).toContain('notamos que dejaste');
    expect(templates[0].buttons[0].url).toBe(
      'https://pilarargentina.store/products/serum-pilar'
    );
    expect(
      originals.pilar.find((t) => t.name === 'pago_pendiente_1')?.usage
    ).toBe('draft');
    expect(
      originals.rasmiaw.find((t) => t.name === 'rasmiaw_pago_rechazado')?.usage
    ).toBe('blocked');
  });
  it('does not invent outbound messages for stopped follow-ups', () => {
    for (const brand of ['pilar', 'rasmiaw'] as const) {
      for (const id of [
        'audit-8',
        'audit-12',
        'audit-28',
        'audit-29',
        'audit-32',
      ]) {
        const c = currentCases(brand).find((c) => c.id === id)!;
        expect(c.example).toBeNull();
        expect(c.templateNames).toEqual([]);
      }
    }
  });
  it('changes the proposed operation by payment model and scope', () => {
    expect(proposedCases(draft).some((c) => c.id === 'design-confirm')).toBe(
      false
    );
    const cod = { ...draft, model: 'cod' as const };
    const ids = proposedCases(cod).map((c) => c.id);
    expect(ids).toContain('design-collection');
    expect(ids).not.toContain('design-rejected');
    expect(ids).not.toContain('design-benefit');
    const disabled = { ...draft, features: { ...draft.features, cart: false } };
    expect(proposedCases(disabled).some((c) => c.id === 'design-cart')).toBe(
      false
    );
    expect(
      isCaseEnabled(
        currentCases('pilar').find((c) => c.id === 'audit-7')!,
        disabled
      )
    ).toBe(false);
  });
  it('keeps original placeholders intact until supplied with explicit example values', () => {
    expect(renderMessage('Hola {{1}}, {{2}}', { '1': 'María' })).toBe(
      'Hola María, {{2}}'
    );
    expect(
      renderMessage('{{brand}}: {{product}}', {
        brand: 'Mi tienda',
        product: 'Producto',
      })
    ).toBe('Mi tienda: Producto');
  });
  it('round trips edits and decisions, rejects invalid imports and unsafe website links', () => {
    const edited = {
      ...draft,
      edits: { 'design-cart': 'Un mensaje personalizado' },
      answers: { goal: 'Recuperar ventas' },
      monthly: 'USD 100',
    };
    expect(parseDraft(JSON.stringify({ draft: edited }), 'pilar')).toEqual(
      edited
    );
    expect(() =>
      parseDraft(JSON.stringify({ draft: edited }), 'rasmiaw')
    ).toThrow();
    expect(() =>
      parseDraft(JSON.stringify({ draft: { ...draft, edits: [] } }), 'pilar')
    ).toThrow();
    expect(safeWebsite('javascript:alert(1)')).toBeUndefined();
    expect(safeWebsite('https://pilarargentina.store')).toBe(
      'https://pilarargentina.store/'
    );
  });
  it('every proposed example and flow resolves in both UI languages', () => {
    const cases = [
      ...currentCases('pilar'),
      ...currentCases('rasmiaw'),
      ...proposedCases({
        ...draft,
        model: 'hybrid',
        features: {
          cart: true,
          discount: true,
          comments: true,
          aftercare: true,
          voice: true,
        },
      }),
      ...proposedCases({ ...draft, model: 'cod' }),
    ];
    for (const c of cases)
      for (const locale of ['es', 'en'] as const)
        for (const key of [
          c.title,
          ...c.path,
          ...(c.example ? [`pitch.msg_${c.example}`] : []),
          ...(c.question ? [c.question] : []),
        ])
          expect(translate(locale, key), key).not.toBe(key);
  });
});
