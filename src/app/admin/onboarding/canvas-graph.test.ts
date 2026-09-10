import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n/translate';
import { buildCanvas, flowEdges, NODE_WIDTH } from './canvas-graph';
import { automationSnapshot } from './canvas-snapshot';
import {
  currentCases,
  proposedCases,
  defaults,
  type PitchDraft,
} from './pitch-data';
import { brands } from './data';

describe('complete onboarding canvas', () => {
  for (const brand of brands)
    for (const locale of ['es', 'en'] as const) {
      it(`${brand}/${locale}: every scenario and production step is connected, translated and non-overlapping`, () => {
        const d: PitchDraft = {
          version: 1,
          brand,
          name: brand,
          site: defaults[brand].site,
          product: 'Example',
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
        const graph = buildCanvas(
          brand,
          cases,
          d,
          (k) => translate(locale, k),
          {
            customer: 'María',
            tracking: 'https://example.com/tracking',
            brand,
            product: 'Example',
          }
        );
        const ids = new Set(graph.nodes.map((n) => n.id));
        expect(ids.size).toBe(graph.nodes.length);
        for (const c of cases) expect(ids.has(c.id)).toBe(true);
        for (const flow of automationSnapshot[brand] ?? []) {
          for (const s of flow.steps) {
            expect(ids.has(s.id)).toBe(true);
            if (s.type === 'condition')
              expect(
                flowEdges(flow)
                  .filter((e) => e.from === s.id)
                  .map((e) => e.label)
                  .sort()
              ).toEqual(['no', 'yes']);
            if (s.type === 'send_template')
              expect(
                graph.nodes.find((n) => n.id === s.id)?.body?.length
              ).toBeGreaterThan(10);
          }
        }
        for (const e of graph.edges) {
          expect(ids.has(e.from)).toBe(true);
          expect(ids.has(e.to)).toBe(true);
        }
        const reachable = new Set(['brand']);
        for (let i = 0; i < graph.nodes.length; i++)
          for (const e of graph.edges)
            if (reachable.has(e.from)) reachable.add(e.to);
        expect(reachable.size).toBe(ids.size);
        for (const [i, n] of graph.nodes.entries()) {
          expect(n.title).not.toMatch(/^(pitch|onboarding)\./);
          expect(n.body ?? '').not.toMatch(/^(pitch|onboarding)\./);
          for (const other of graph.nodes.slice(i + 1)) {
            expect(
              n.x < other.x + NODE_WIDTH &&
                n.x + NODE_WIDTH > other.x &&
                n.y < other.y + other.height &&
                n.y + n.height > other.y,
              `${n.id} overlaps ${other.id}`
            ).toBe(false);
          }
        }
      });
    }
});
