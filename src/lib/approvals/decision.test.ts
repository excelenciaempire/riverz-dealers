import { describe, expect, it } from 'vitest';
import { approvalDecision } from './decision';

describe('approval decision input', () => {
  it('supports the current panel and explicit legacy decisions during rollout', () => {
    expect(approvalDecision({ aprobar: true })).toBe('aprobada');
    expect(approvalDecision({ aprobar: false })).toBe('rechazada');
    expect(approvalDecision({ decision: 'aprobada' })).toBe('aprobada');
    expect(approvalDecision({ decision: 'rechazada' })).toBe('rechazada');
  });
  it('rejects conflicting or truthy values that could inadvertently approve money', () => {
    for (const input of [null, [], {}, { aprobar: 'false' }, { aprobar: 1 },
      { decision: 'yes' }, { aprobar: true, decision: 'rechazada' }, { aprobar: false, decision: 'aprobada' }]) {
      expect(approvalDecision(input)).toBeNull();
    }
  });
});
