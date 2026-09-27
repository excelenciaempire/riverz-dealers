import { expect, it } from 'vitest';
import {
  alertCandidates,
  rememberAlerts,
  ALERT_REPEAT_GUARD_MS,
} from './alert-history';
it('suppresses flapping incidents, not unrelated new incidents', () => {
  const now = Date.now(),
    history = rememberAlerts({}, ['cron:ml'], now);
  expect(
    alertCandidates(['cron:ml', 'cron:other'], history, now + 3600000)
  ).toEqual(['cron:other']);
  expect(
    alertCandidates(['cron:ml'], history, now + ALERT_REPEAT_GUARD_MS)
  ).toEqual(['cron:ml']);
});
it('retains recent notification evidence and prunes expired history', () => {
  const now = Date.now();
  expect(
    rememberAlerts(
      { old: new Date(now - 8 * ALERT_REPEAT_GUARD_MS).toISOString() },
      ['new'],
      now
    )
  ).toEqual({ new: new Date(now).toISOString() });
});
