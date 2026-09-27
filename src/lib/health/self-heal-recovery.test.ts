import { expect, it, vi } from 'vitest';
import { healStalledWork } from './self-heal';
function database(fail = false) {
  const changes: Array<{ table: string; patch: unknown }> = [];
  const filters: Array<[string, unknown]> = [];
  const from = (table: string) => {
    let writing = false;
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      lte: (key: string, value: unknown) => {
        filters.push([key, value]);
        return q;
      },
      limit: () => q,
      update: (patch: unknown) => {
        writing = true;
        changes.push({ table, patch });
        return q;
      },
      then: (resolve: (x: unknown) => unknown) =>
        Promise.resolve({
          error: null,
          data: writing
            ? [{ id: 'claimed' }]
            : table === 'automation_pending_executions'
              ? [
                  {
                    id: 'safe',
                    automations: {
                      trigger_config: { session_template_fallback: true },
                      automation_steps: [{ step_type: 'send_template' }],
                    },
                  },
                  {
                    id: 'uncertain',
                    automations: {
                      trigger_config: { session_template_fallback: true },
                      automation_steps: [{ step_type: 'send_webhook' }],
                    },
                  },
                ]
              : [{ id: 'legacy-flow' }],
        }).then(resolve),
    };
    return q;
  };
  const rpc = vi
    .fn()
    .mockResolvedValue(
      fail
        ? { error: { message: 'settlement unavailable' } }
        : { error: null, data: 2 }
    );
  return { db: { from, rpc }, changes, filters };
}
it('uses claim time and only requeues deliveries with a durable deduplication claim', async () => {
  const { db, changes, filters } = database();
  const r = await healStalledWork(
    db as never,
    new Date('2026-09-27T20:00:00Z')
  );
  expect(filters.every(([key]) => key === 'claimed_at')).toBe(true);
  expect(changes).toEqual([
    {
      table: 'automation_pending_executions',
      patch: { status: 'pending', run_at: '2026-09-27T20:00:00.000Z' },
    },
    { table: 'automation_pending_executions', patch: { status: 'failed' } },
    { table: 'flow_pending_executions', patch: { status: 'failed' } },
  ]);
  expect(r).toEqual({
    automationPendingReset: 1,
    flowPendingReset: 0,
    automationLogsSettled: 2,
    manualReview: 2,
  });
});
it('does not report success when atomic settlement fails', async () => {
  const { db } = database(true);
  await expect(healStalledWork(db as never)).rejects.toThrow(
    'settlement unavailable'
  );
});
