import { describe, expect, it } from 'vitest';
import {
  planLogisticsDraft,
  confirmationFromVoice,
  LOGISTICS_DRAFT_POLICY,
  type LogisticsSnapshot,
  type LogisticsDraftPolicy,
} from './logistics-draft';
import {
  buildLogisticsPreview,
  logisticsTrackingCandidate,
  verifiedTrackingUrl,
  type VerifiedTracking,
} from './logistics-messages';

const now = Date.UTC(2026, 8, 13, 15);
const hour = 3_600_000;
const base = (patch: Partial<LogisticsSnapshot> = {}): LogisticsSnapshot => ({
  workspaceId: 'workspace-test',
  orderId: 'order-test',
  revision: 'commercial-v1',
  observedAt: now,
  stageSince: now - hour,
  stage: 'pending_confirmation',
  identityVerified: true,
  dataComplete: true,
  stockVerified: true,
  canDispatchExisting: true,
  canCancelExisting: true,
  optedOut: false,
  humanReview: false,
  retryScheduled: false,
  callPending: false,
  confirmation: {
    completed: false,
    allAttemptsAccountedFor: false,
    deliveryFailureUnresolved: false,
  },
  ...patch,
});
const evidence = confirmationFromVoice({
  ...base(),
  callId: 'call-test',
  purpose: 'confirmation',
  status: 'completed',
  outcome: 'confirmed',
  endedAt: now - 1000,
})!;
const official = (): LogisticsSnapshot =>
  base({
    stage: 'out_for_delivery',
    trackingNumber: '000123456789',
    carrierHost: 'carrier.example',
    incident: {
      id: 'incident-test',
      kind: 'recipient_absent',
      source: 'dropi_incidents',
      verified: true,
      requiresAction: true,
      resolved: false,
      openedAt: now - 5 * hour,
    },
  });
const tracking: VerifiedTracking = {
  carrierName: 'Transportadora de prueba',
  carrierHost: 'carrier.example',
  guide: '000123456789',
  url: 'https://carrier.example/tracking/000123456789',
  verifiedForGuide: '000123456789',
  verifiedAt: now,
};
const customer = {
  name: 'Ana',
  product: 'pelota LED',
  language: 'es' as const,
};
const proposal = (s: LogisticsSnapshot, policy?: LogisticsDraftPolicy) =>
  planLogisticsDraft(s, now, policy).proposal;

describe('Dropi logistics stays offline', () => {
  it('makes dispatch reviewable, never executable', () => {
    expect(planLogisticsDraft(base({ evidence }), now)).toMatchObject({
      mode: 'draft',
      executable: false,
      proposal: 'dispatch_existing',
    });
  });
  it('does not treat the screenshot note as an official incident', () => {
    expect(
      proposal(
        base({
          stage: 'out_for_delivery',
          retryScheduled: true,
          trackingNote: 'DESTINATARIO NO SE ENCUENTRA.',
        })
      )
    ).toBe('observe');
  });
  it('does not contact for unverified, resolved or non-actionable incidents', () => {
    for (const patch of [
      { verified: false },
      { resolved: true },
      { requiresAction: false },
    ]) {
      const s = official();
      s.incident = { ...s.incident!, ...patch };
      expect(proposal(s)).toBe('observe');
    }
  });
  it('an official actionable incident can supersede a retry note', () => {
    expect(proposal({ ...official(), retryScheduled: true })).toBe(
      'draft_incident_message'
    );
  });
  it('waits for an ongoing call, including when confirmation time expires', () => {
    expect(proposal(base({ evidence, callPending: true }))).toBe('observe');
  });
  it.each(['delivered', 'cancelled', 'returned'] as const)(
    'stops for terminal state %s',
    (stage) => {
      expect(proposal({ ...official(), stage })).toBe('stop');
    }
  );
  it('stops on opt-out and gives human interventions priority', () => {
    expect(proposal({ ...official(), optedOut: true })).toBe('stop');
    expect(proposal(base({ evidence, humanReview: true }))).toBe('review');
  });
  it('requires fresh, complete order evidence and available stock', () => {
    for (const patch of [
      { observedAt: now - hour },
      { observedAt: NaN },
      { dataComplete: false },
      { stockVerified: false },
      { identityVerified: false },
      { canDispatchExisting: false },
    ]) {
      expect(proposal(base({ evidence, ...patch }))).toBe('review');
    }
    expect(
      proposal(base({ evidence: { ...evidence, orderId: 'other-order' } }))
    ).toBe('review');
    expect(
      proposal(base({ evidence: { ...evidence, revision: 'old-address' } }))
    ).toBe('review');
  });
  it('a newer reply invalidates the earlier automatic decision', () => {
    expect(proposal(base({ evidence, latestCustomerReplyAt: now }))).toBe(
      'review'
    );
  });
  it('a status label alone is not customer confirmation', () => {
    expect(proposal(base({ stage: 'confirmed' }))).toBe(
      'continue_confirmation'
    );
  });
  it('requires complete follow-up, delivered attempts, final deadline and explicit policy to propose cancellation', () => {
    const s = base({
      confirmation: {
        completed: true,
        allAttemptsAccountedFor: true,
        deliveryFailureUnresolved: false,
        finalWaitUntil: now - 1,
      },
    });
    const enabled = { ...LOGISTICS_DRAFT_POLICY, cancelAfterExhaustion: true };
    expect(proposal(s)).toBe('continue_confirmation');
    expect(proposal(s, enabled)).toBe('cancel_existing');
    for (const patch of [
      { completed: false },
      { allAttemptsAccountedFor: false },
      { finalWaitUntil: undefined },
      { finalWaitUntil: now + 1 },
      { finalWaitUntil: NaN },
    ]) {
      expect(
        proposal(
          { ...s, confirmation: { ...s.confirmation, ...patch } },
          enabled
        )
      ).toBe('continue_confirmation');
    }
    expect(
      proposal(
        {
          ...s,
          confirmation: { ...s.confirmation, deliveryFailureUnresolved: true },
        },
        enabled
      )
    ).toBe('review_message_delivery');
  });
  it('a rejection during transport requires a separate return process', () => {
    expect(
      proposal({
        ...official(),
        evidence: { ...evidence, decision: 'cancelled' },
      })
    ).toBe('review');
  });
  it('a label that has stalled raises an internal supplier review', () => {
    expect(
      proposal(base({ stage: 'label_created', stageSince: now - 25 * hour }))
    ).toBe('review_supplier_delay');
  });
  it('separates incident follow-up from exhausted confirmation', () => {
    const s = official();
    s.confirmation = {
      completed: true,
      allAttemptsAccountedFor: true,
      deliveryFailureUnresolved: false,
      finalWaitUntil: now - hour,
    };
    s.incidentFollowup = {
      incidentId: s.incident!.id,
      messageDeliveredAt: now - 4 * hour,
      messageFailed: false,
      completed: false,
    };
    expect(proposal(s)).toBe('draft_incident_call');
    expect(
      proposal({
        ...s,
        incidentFollowup: {
          ...s.incidentFollowup,
          messageDeliveredAt: now - hour,
        },
      })
    ).toBe('observe');
    expect(proposal({ ...s, latestCustomerReplyAt: now - hour })).toBe(
      'review'
    );
    expect(
      proposal({
        ...s,
        incidentFollowup: { ...s.incidentFollowup, messageFailed: true },
      })
    ).toBe('review_message_delivery');
    expect(
      proposal({
        ...s,
        incidentFollowup: { ...s.incidentFollowup, completed: true },
      })
    ).toBe('review');
  });
  it('never schedules an old incident follow-up for a new incident', () => {
    expect(
      proposal({
        ...official(),
        incidentFollowup: {
          incidentId: 'old-incident',
          messageDeliveredAt: now - 4 * hour,
          messageFailed: false,
          completed: false,
        },
      })
    ).toBe('draft_incident_message');
  });
  it('uses distinct stable keys across workspaces and incident cycles', () => {
    const s = official();
    const key = planLogisticsDraft(s, now).dedupeKey;
    expect(planLogisticsDraft(s, now + 1).dedupeKey).toBe(key);
    expect(
      planLogisticsDraft({ ...s, workspaceId: 'other' }, now).dedupeKey
    ).not.toBe(key);
    expect(
      planLogisticsDraft(
        { ...s, incident: { ...s.incident!, id: 'second' } },
        now
      ).dedupeKey
    ).not.toBe(key);
  });
});

describe('voice result evidence', () => {
  it.each([
    'no_answer',
    'busy',
    'voicemail',
    'failed',
    'canceled',
    'queued',
  ] as const)(
    '%s cannot confirm a shipment even with a stale outcome',
    (status) => {
      expect(
        confirmationFromVoice({
          ...base(),
          callId: 'test',
          purpose: 'confirmation',
          status,
          outcome: 'confirmed',
          endedAt: now,
        })
      ).toBeNull();
    }
  );
  it('recovery of an incident does not dispatch a second order', () => {
    expect(
      confirmationFromVoice({
        ...base(),
        callId: 'test',
        purpose: 'incident',
        status: 'completed',
        outcome: 'recovered',
        endedAt: now,
      })
    ).toBeNull();
  });
  it('callback and ambiguous declined results go to review, not cancellation', () => {
    for (const outcome of ['callback_requested', 'declined'] as const) {
      expect(
        confirmationFromVoice({
          ...base(),
          callId: 'test',
          purpose: 'confirmation',
          status: 'completed',
          outcome,
          endedAt: now,
        })?.decision
      ).toBe('needs_review');
    }
  });
});

describe('customer tracking and message quality', () => {
  it('reuses the existing Envía direct tracking route', () => {
    expect(logisticsTrackingCandidate('ENVIA', '000123456789')).toBe(
      'https://hub.envia.co/landingrastreo/Rastreo/Index?guia=000123456789'
    );
  });
  it('preserves leading zeros and a verified guide-specific URL', () => {
    const packet = buildLogisticsPreview(official(), customer, tracking, now);
    expect(packet.message).toContain('*000123456789*');
    expect(packet.message).toContain(tracking.url);
    expect(packet.message).toContain('Ana 😊\n\n');
    expect(packet.message).toContain('pelota LED');
    expect(packet.blockers).toContain('activation_not_authorized');
  });
  it('supports the customer agent language', () => {
    expect(
      buildLogisticsPreview(
        official(),
        { ...customer, language: 'en' },
        tracking,
        now
      ).message
    ).toContain('Hi, Ana');
  });
  it('changes the question for the actual incident type', () => {
    const s = official();
    s.incident!.kind = 'address_issue';
    expect(buildLogisticsPreview(s, customer, tracking, now).message).toContain(
      'dirección completa'
    );
    s.incident!.kind = 'customer_rejected';
    expect(
      buildLogisticsPreview(s, customer, tracking, now).message
    ).toBeNull();
  });
  it('does not produce an incident message from a retry note', () => {
    const s = official();
    s.incident = undefined;
    s.trackingNote = 'DESTINATARIO NO SE ENCUENTRA.';
    expect(
      buildLogisticsPreview(s, customer, tracking, now).message
    ).toBeNull();
  });
  it.each([
    'https://carrier.example/',
    'https://carrier.example/guide/000123456789.pdf',
    'https://carrier.example.evil.test/000123456789',
    'http://carrier.example/000123456789',
    'javascript:alert(1)',
    'https://user:pass@carrier.example/000123456789',
    'https://carrier.example/tracking/999000123456789',
    'https://carrier.example/tracking/%ZZ',
  ])('rejects an invalid carrier link: %s', (url) => {
    expect(verifiedTrackingUrl({ ...tracking, url }, now)).toBeNull();
  });
  it('does not mix guides between customers', () => {
    expect(
      buildLogisticsPreview(
        { ...official(), trackingNumber: '999999999999' },
        customer,
        tracking,
        now
      ).message
    ).toBeNull();
    expect(
      verifiedTrackingUrl({ ...tracking, verifiedForGuide: 'other' }, now)
    ).toBeNull();
    expect(
      verifiedTrackingUrl({ ...tracking, verifiedAt: now - 8 * 24 * hour }, now)
    ).toBeNull();
  });
  it('incident call preview disables the existing COD writeback', () => {
    const s = official();
    s.incidentFollowup = {
      incidentId: s.incident!.id,
      messageDeliveredAt: now - 4 * hour,
      messageFailed: false,
      completed: false,
    };
    expect(
      buildLogisticsPreview(s, customer, tracking, now).callContext
    ).toMatchObject({
      cod_writeback: false,
      skip_if_replied: true,
      tracking_number: tracking.guide,
      tracking_url: tracking.url,
    });
  });
});
