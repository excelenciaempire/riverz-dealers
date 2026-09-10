import { describe, it, expect } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import { brands } from './data';
import {
  currentCases,
  proposedCases,
  defaults,
  type PitchDraft,
} from './pitch-data';
import {
  buildClientCanvas,
  groupJourneyCases,
  journeyFor,
  journeyIds,
} from './client-journeys';
import { NODE_WIDTH } from './canvas-graph';

describe('client journeys', () => {
  for (const brand of brands)
    for (const locale of ['es', 'en'] as const)
      it(`${brand}/${locale}: preserves coverage without repeating the audit as new sales scenarios`, () => {
        const d: PitchDraft = {
          version: 1,
          brand,
          name: brand,
          site: defaults[brand].site,
          product: 'Product',
          customer: 'María',
          amount: '$100',
          order: '#1042',
          model: defaults[brand].model,
          features: {
            cart: true,
            discount: true,
            comments: true,
            aftercare: true,
            voice: true,
          },
          discount: 5,
          excluded: [],
          edits: {},
          answers: {},
          monthly: '',
          launch: '',
          owner: '',
          reviewed: false,
        };
        const cases = [...currentCases(brand), ...proposedCases(d)];
        for (const c of cases)
          expect(
            c.id === 'audit-35' || journeyIds.includes(journeyFor(c)!)
          ).toBe(true);
        const cart = groupJourneyCases(cases, 'recovery').filter(
          (g) => g.id === 'cart'
        );
        expect(cart).toHaveLength(1);
        expect(cart[0].members.some((c) => c.id === 'design-cart')).toBe(true);
        if (brand !== 'contraentrega')
          expect(cart[0].members.some((c) => c.id === 'audit-7')).toBe(true);
        const t = (k: string) => translate(locale, k);
        for (const expanded of [[], journeyIds.map((j) => `journey-${j}`)]) {
          const graph = buildClientCanvas(
            brand,
            cases,
            d,
            t,
            {
              customer: 'María',
              brand,
              product: 'Product',
              tracking: '[tracking]',
            },
            expanded
          );
          expect(graph.nodes.filter((n) => n.kind === 'journey')).toHaveLength(
            8
          );
          if (!expanded.length) expect(graph.nodes.length).toBeLessThan(40);
          const ids = new Set(graph.nodes.map((n) => n.id));
          expect(ids.size).toBe(graph.nodes.length);
          for (const e of graph.edges) {
            expect(ids.has(e.from)).toBe(true);
            expect(ids.has(e.to)).toBe(true);
          }
          for (const journey of journeyIds) {
            const templates = graph.nodes
              .filter(
                (n) => n.id.startsWith(`journey-${journey}-`) && n.template
              )
              .map((n) => n.template);
            expect(new Set(templates).size).toBe(templates.length);
          }
          for (const [i, n] of graph.nodes.entries()) {
            expect(`${n.title} ${n.body ?? ''} ${n.caption ?? ''}`).not.toMatch(
              /(?:^|\s)(?:pitch|onboarding)\./
            );
            for (const other of graph.nodes.slice(i + 1)) {
              if (
                n.x < other.x + NODE_WIDTH &&
                n.x + NODE_WIDTH > other.x &&
                n.y < other.y + other.height &&
                n.y + n.height > other.y
              )
                throw new Error(`${n.id} overlaps ${other.id}`);
            }
          }
        }
      });
});
