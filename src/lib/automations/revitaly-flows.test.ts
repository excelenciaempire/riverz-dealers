import { expect, it } from 'vitest';
import {
  buildTrees,
  templates,
} from '../../../scripts/reconcile-revitaly-flows';
import { validateStepsForActivation } from './validate';
import type { BuilderStepInput } from './steps-tree';

function walk(steps: BuilderStepInput[], vars: Record<string, string> = {}) {
  let minutes = 0;
  const messages: Array<{ name: string; minute: number }> = [];
  const visit = (nodes: BuilderStepInput[]) => {
    for (const s of nodes) {
      const c = s.step_config;
      if (s.step_type === 'wait')
        minutes +=
          Number(c.amount) *
          (c.unit === 'days' ? 1440 : c.unit === 'hours' ? 60 : 1);
      if (s.step_type === 'send_template')
        messages.push({ name: String(c.template_name), minute: minutes });
      if (s.step_type === 'condition') {
        const yes =
          c.subject === 'context_var'
            ? vars[String(c.operand)] === String(c.value)
            : c.subject === 'tag_presence'
              ? false
              : c.value === 'false';
        visit((yes ? s.branches?.yes : s.branches?.no) ?? []);
      }
    }
  };
  visit(steps);
  return messages;
}
it('validates every Revitaly tree and each referenced template', () => {
  for (const tree of Object.values(buildTrees()))
    expect(validateStepsForActivation(tree)).toEqual([]);
  expect(templates).toHaveLength(21);
  expect(new Set(templates.map((t) => t.nombre)).size).toBe(templates.length);
});
it('preserves four cart contacts at a calmer cadence and same-day payment attempts', () => {
  const t = buildTrees();
  expect(walk(t.cart).map((m) => m.minute)).toEqual([30, 1440, 2880, 4320]);
  expect(
    walk(t.pending, { financial_status: 'pending' }).map((m) => m.minute)
  ).toEqual([30, 180, 420, 1440]);
  expect(walk(t.rejected).map((m) => m.minute)).toEqual([10, 60, 180, 1440]);
  expect(walk(t.pending, { financial_status: 'paid' })).toEqual([]);
});
it.each([
  [1, 30],
  [2, 60],
  [3, 90],
  [10, 300],
])('shows the complete delivered journey for %s bottles', (units, day) => {
  const messages = walk(buildTrees().retention, {
    retention_product: 'Revitaly™ – Recuperá un cabello más fuerte y abundante',
    retention_units: String(units),
  });
  expect(messages.map((m) => m.minute / 1440)).toEqual([
    1,
    6,
    14,
    day,
    day + 7,
    day + 14,
    day + 24,
  ]);
  expect(messages[4].name).toBe(`revitaly_recompra_oferta_${units}_v4`);
});
