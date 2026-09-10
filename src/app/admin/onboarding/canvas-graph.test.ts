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
import { horizontalEdge } from './horizontal-layout';

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
        for (const c of cases) {
          const entry = graph.nodes.find((n) => n.id === c.id)!;
          const row = [
            entry,
            ...c.path.map(
              (_, i) => graph.nodes.find((n) => n.id === `${c.id}-path-${i}`)!
            ),
            ...graph.nodes.filter(
              (n) =>
                n.id.startsWith(`${c.id}-message-`) || n.id === `${c.id}-silent`
            ),
          ];
          expect(row.every((n) => n.y === entry.y)).toBe(true);
          expect(
            row.every((n, i) => i === 0 || n.x > row[i - 1].x + NODE_WIDTH)
          ).toBe(true);
        }
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
          const a = graph.nodes.find((n) => n.id === e.from)!;
          const b = graph.nodes.find((n) => n.id === e.to)!;
          if (!e.example) expect(b.x).toBeGreaterThan(a.x + NODE_WIDTH);
          if (e.label === 'yes') {
            const noEdge = graph.edges.find(
              (edge) => edge.from === a.id && edge.label === 'no'
            )!;
            const no = graph.nodes.find((n) => n.id === noEdge.to)!;
            expect(b.y).toBeLessThan(no.y);
            expect(a.y).toBe((b.y + no.y) / 2);
          }
          let x = 0,
            y = 0;
          for (const command of horizontalEdge(a, b, e).path.matchAll(
            /([MHV])(-?[\d.]+)(?:,(-?[\d.]+))?/g
          )) {
            const nextX = command[1] === 'V' ? x : Number(command[2]);
            const nextY =
              command[1] === 'H'
                ? y
                : Number(command[1] === 'M' ? command[3] : command[2]);
            if (command[1] !== 'M')
              for (const n of graph.nodes) {
                if (n.id === a.id || n.id === b.id) continue;
                const crosses =
                  command[1] === 'H'
                    ? y > n.y &&
                      y < n.y + n.height &&
                      Math.max(x, nextX) > n.x &&
                      Math.min(x, nextX) < n.x + NODE_WIDTH
                    : x > n.x &&
                      x < n.x + NODE_WIDTH &&
                      Math.max(y, nextY) > n.y &&
                      Math.min(y, nextY) < n.y + n.height;
                if (crosses)
                  throw new Error(`${a.id} → ${b.id} crosses ${n.id}`);
              }
            x = nextX;
            y = nextY;
          }
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
