import { describe, expect, it } from 'vitest';
import {
  isInsideMetaDmResumeWindow,
  readMetaDmBackfillPending,
  syncFullThread,
  updateMetaDmBackfillCheckpoint,
} from './meta-dm-backfill-state';

describe('Meta DM backfill checkpoint', () => {
  const mark = '2026-09-04T16:00:00.000Z';
  const objective = '2026-09-04T18:00:00.000Z';
  const failedThread = '2026-09-04T17:42:00.000Z';

  it('keeps the old mark and retries the exact thread that failed', () => {
    const next = updateMetaDmBackfillCheckpoint(
      { dm_backfill_marca: mark },
      { complete: false, objective, resumeAt: failedThread }
    );
    const pending = readMetaDmBackfillPending(next.dm_backfill_pendiente);

    expect(next.dm_backfill_marca).toBe(mark);
    expect(pending).toEqual({ hasta: failedThread, objetivo: objective });
    expect(isInsideMetaDmResumeWindow(Date.parse(failedThread), pending)).toBe(
      true
    );
    expect(
      isInsideMetaDmResumeWindow(
        Date.parse('2026-09-04T17:43:00.000Z'),
        pending
      )
    ).toBe(false);
  });

  it('advances the mark only after the entire pass closes', () => {
    const next = updateMetaDmBackfillCheckpoint(
      {
        dm_backfill_marca: mark,
        dm_backfill_pendiente: { hasta: failedThread, objetivo: objective },
      },
      { complete: true, objective, resumeAt: failedThread }
    );

    expect(next.dm_backfill_marca).toBe(objective);
    expect(next).not.toHaveProperty('dm_backfill_pendiente');
  });
});

describe('syncFullThread', () => {
  const base = { hasMark: true, knownContact: true, resuming: false, resumingFull: undefined };

  it('trae completo el hilo la primera vez que se lo ve', () => {
    expect(syncFullThread({ ...base, hasMark: false })).toBe(true);
    expect(syncFullThread({ ...base, knownContact: false })).toBe(true);
  });

  it('con marca y contacto conocido sólo trae lo nuevo', () => {
    expect(syncFullThread(base)).toBe(false);
  });

  it('un hilo retomado sigue en el modo en que empezó', () => {
    expect(syncFullThread({ ...base, resuming: true, resumingFull: true })).toBe(true);
    expect(syncFullThread({ ...base, hasMark: false, resuming: true, resumingFull: null })).toBe(false);
  });
});
