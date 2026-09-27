import { expect, it } from 'vitest';
import { retentionStockReply } from './retention-reply';
const now = new Date('2026-09-27T15:00:00Z');
const vars = {
  retention_stage: 'stock_check',
  retention_question_cursor: 'question',
  retention_offer_cursor: 'offer',
};
it('offers immediately when little remains', () => {
  expect(retentionStockReply('Me queda poco', vars, now)).toMatchObject({
    cursor: 'offer',
    runAt: now,
  });
});
it('repeats the question after 15 days at most twice', () => {
  const first = retentionStockReply('Tengo para rato', vars, now)!;
  expect(first.cursor).toBe('question');
  expect(first.runAt.toISOString()).toBe('2026-10-12T15:00:00.000Z');
  const second = retentionStockReply('Tengo para rato', first.vars, now)!;
  expect(second.vars.retention_stock_deferrals).toBe(2);
  expect(retentionStockReply('Tengo para rato', second.vars, now)?.cursor).toBe(
    'offer'
  );
});
it('does not schedule arbitrary replies or unrelated stages', () => {
  expect(retentionStockReply('Necesito ayuda', vars, now)).toBeNull();
  expect(
    retentionStockReply(
      'Tengo para rato',
      { ...vars, retention_stage: 'care' },
      now
    )
  ).toBeNull();
});
