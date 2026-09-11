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
import { operationCatalog } from '@/lib/i18n/messages/pitch-operations';
import { automationSnapshot } from './canvas-snapshot';

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
        const expandedAll = journeyIds.map((j) => `journey-${j}`);
        const origin = 'operation-recommend-decision';
        const variants: {
          expanded: string[];
          choices?: Record<string, string>;
        }[] = [
          { expanded: [] },
          { expanded: expandedAll },
          ...[
            'human',
            'silence',
            'topic',
            'media',
            'optout',
            'unknown',
            'failure',
            'identity',
          ].map((route) => ({
            expanded: expandedAll,
            choices: { [origin]: `operation-${route}` },
          })),
          {
            expanded: expandedAll,
            choices: {
              [origin]: 'operation-human',
              [`${origin}-inline-human-decision`]: 'operation-failure',
            },
          },
        ];
        const layouts = new Map<string, ReturnType<typeof buildClientCanvas>>();
        for (const { expanded, choices } of variants) {
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
            expanded,
            choices
          );
          expect(graph.nodes.filter((n) => n.kind === 'journey')).toHaveLength(
            8
          );
          if (!expanded.length) expect(graph.nodes.length).toBeLessThan(40);
          const ids = new Set(graph.nodes.map((n) => n.id));
          if (expanded.length) {
            if (!choices) layouts.set('base', graph);
            else {
              const baseline = layouts.get(
                Object.keys(choices).length > 1 ? choices[origin] : 'base'
              )!;
              const previous = new Map(baseline.nodes.map((n) => [n.id, n]));
              for (const node of graph.nodes) {
                const before = previous.get(node.id);
                if (before)
                  expect({ x: node.x, y: node.y }).toEqual({
                    x: before.x,
                    y: before.y,
                  });
              }
              expect(graph.height).toBe(baseline.height);
              layouts.set(choices[origin], graph);
            }
          }
          expect(ids.size).toBe(graph.nodes.length);
          for (const e of graph.edges) {
            expect(ids.has(e.from)).toBe(true);
            expect(ids.has(e.to)).toBe(true);
          }
          for (const [decision, choice] of Object.entries(choices ?? {})) {
            const local = `${decision}-inline-${choice.replace('operation-', '')}`;
            expect(ids.has(local)).toBe(true);
            expect(graph.edges).toContainEqual({ from: decision, to: local });
            expect(
              graph.edges.some((e) => e.from === decision && e.to === choice)
            ).toBe(false);
            expect(graph.nodes.find((n) => n.id === local)!.x).toBeGreaterThan(
              graph.nodes.find((n) => n.id === decision)!.x
            );
          }
          if (expanded.length) {
            for (const s of operationCatalog) {
              const applicable =
                !('models' in s) ||
                (s.models as readonly string[]).includes(d.model);
              expect(ids.has(`operation-${s.id}`)).toBe(applicable);
              if (!applicable) continue;
              for (const suffix of [
                'reply',
                'decision',
                'success',
                'exception',
              ])
                expect(ids.has(`operation-${s.id}-${suffix}`)).toBe(
                  !(
                    ['success', 'exception'].includes(suffix) &&
                    !!choices?.[`operation-${s.id}-decision`]
                  )
                );
            }
            for (const n of graph.nodes)
              for (const route of n.routes ?? [])
                expect(ids.has(route)).toBe(true);
            for (const flow of automationSnapshot[brand] ?? []) {
              expect(ids.has(flow.id)).toBe(true);
              for (const step of flow.steps)
                expect(ids.has(step.id)).toBe(true);
            }
            // Template-bearing cases must not suppress their AI examples, nor
            // other examples grouped into the same business concept.
            for (const c of cases.filter((c) => c.example)) {
              if (
                d.model === 'prepaid' &&
                /^audit-(16|17|18|19|20|21)$/.test(c.id)
              )
                continue;
              expect(
                ids.has(`journey-${journeyFor(c)}-example-${c.example}`)
              ).toBe(true);
            }
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
            if (n.note) {
              expect(n.body).not.toContain(n.note);
              expect(n.body).not.toMatch(/[«»]/);
            }
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
