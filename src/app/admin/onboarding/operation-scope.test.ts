import { describe, expect, it } from 'vitest';
import { availableOperations, selectedOperations } from './operation-scope';
import { buildClientCanvas, journeyIds } from './client-journeys';
import { defaults, type PitchDraft } from './pitch-data';
import { translate } from '@/lib/i18n/translate';

describe('merchant-specific proposal', () => {
  for (const brand of ['pilar', 'rasmiaw', 'contraentrega'] as const)
    for (const model of ['prepaid', 'hybrid', 'cod'] as const)
      it(`${brand}/${model} respects payment, disabled features and individual exclusions`, () => {
        const draft: PitchDraft = {
          version: 1,
          brand,
          name: brand,
          site: defaults[brand].site,
          model,
          product: 'Product',
          customer: 'María',
          amount: '$100',
          order: '#1042',
          features: {
            cart: false,
            discount: false,
            comments: false,
            aftercare: false,
            voice: false,
          },
          excluded: ['operation-tracking'],
          edits: {},
          answers: {},
          discount: 0,
          monthly: '',
          launch: '',
          owner: '',
          reviewed: false,
        };
        const ids = selectedOperations(draft).map((s) => s.id);
        expect(ids).not.toContain('tracking');
        expect(ids).toContain('dispatch');
        for (const disabled of [
          'abandoned',
          'discount',
          'publicsale',
          'publicfilter',
          'voicecall',
          'reactivation',
          'care',
        ])
          expect(ids).not.toContain(disabled);
        expect(ids.includes('codconfirm')).toBe(model !== 'prepaid');
        expect(ids.includes('paymentlink')).toBe(model !== 'cod');
        expect(ids.includes('paymentpending')).toBe(model !== 'cod');
        expect(
          availableOperations(draft).some((s) => s.id === 'tracking')
        ).toBe(true);
        for (const locale of ['es', 'en'] as const) {
          const collapsed = buildClientCanvas(
            brand,
            [],
            draft,
            (key) => translate(locale, key),
            {},
            []
          );
          expect(collapsed.nodes.every((n) => Number.isFinite(n.y))).toBe(true);
          const graph = buildClientCanvas(
            brand,
            [],
            draft,
            (key) => translate(locale, key),
            {},
            journeyIds.map((j) => `journey-${j}`)
          );
          expect(
            graph.nodes
              .filter((n) => n.kind === 'scenario')
              .map((n) => n.id)
              .sort()
          ).toEqual(ids.map((id) => `operation-${id}`).sort());
          for (const node of graph.nodes) {
            expect(Number.isFinite(node.y)).toBe(true);
            for (const route of node.routes ?? [])
              expect(graph.nodes.some((n) => n.id === route)).toBe(true);
          }
          const internal = graph.nodes.find(
            (n) => n.id === 'operation-crm-reply'
          )!;
          expect(internal.kind).toBe('action');
          expect(internal.title).toBe(
            translate(locale, 'pitch.operationInternal')
          );
          expect(
            graph.nodes.find((n) => n.id === 'operation-crm-decision')!.routes
          ).toBeUndefined();
          const custom = buildClientCanvas(
            brand,
            [],
            { ...draft, answers: { customCases: 'Entrega en dos domicilios' } },
            (key) => translate(locale, key),
            {},
            journeyIds.map((j) => `journey-${j}`)
          );
          expect(
            custom.nodes.find((n) => n.id === 'merchant-custom-cases')!.body
          ).toBe('Entrega en dos domicilios');
          expect(custom.edges).toContainEqual({
            from: 'merchant-custom-cases',
            to: 'merchant-custom-cases-design',
          });
        }
      });
});
