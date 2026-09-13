/** Offline planning only. No DB, scheduler, network or execution entry point.
 * Provider adapters must supply verified snapshots; free-text tracking notes
 * and model output are never evidence of an official incident or confirmation.
 */
import type { VoiceCallOutcome, VoiceCallStatus } from '@/types';

export type LogisticsStage =
  | 'pending_confirmation'
  | 'confirmed'
  | 'awaiting_supplier'
  | 'label_created'
  | 'awaiting_collection'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'unknown';
export type IncidentKind =
  | 'recipient_absent'
  | 'address_issue'
  | 'pickup_required'
  | 'payment_issue'
  | 'customer_rejected'
  | 'unknown';
export interface OrderIdentity {
  workspaceId: string;
  orderId: string;
  revision: string;
}
export interface ConfirmationEvidence extends OrderIdentity {
  evidenceId: string;
  channel: 'whatsapp' | 'voice';
  decision: 'confirmed' | 'cancelled' | 'needs_review' | 'opt_out';
  at: number;
}
export interface OfficialIncident {
  id: string;
  kind: IncidentKind;
  source: 'dropi_incidents' | 'carrier_incidents';
  verified: boolean;
  requiresAction: boolean;
  resolved: boolean;
  openedAt: number;
  deadlineAt?: number;
}
export interface LogisticsSnapshot extends OrderIdentity {
  observedAt: number;
  stageSince: number;
  stage: LogisticsStage;
  identityVerified: boolean;
  dataComplete: boolean;
  stockVerified: boolean;
  canDispatchExisting: boolean;
  canCancelExisting: boolean;
  optedOut: boolean;
  humanReview: boolean;
  /** Informational only, deliberately never parsed for actions. */
  trackingNote?: string;
  trackingNumber?: string;
  carrierHost?: string;
  retryScheduled: boolean;
  incident?: OfficialIncident;
  evidence?: ConfirmationEvidence;
  /** Most recent customer message or completed human-connected call. */
  latestCustomerReplyAt?: number;
  callPending: boolean;
  confirmation: {
    completed: boolean;
    allAttemptsAccountedFor: boolean;
    deliveryFailureUnresolved: boolean;
    finalWaitUntil?: number;
  };
  incidentFollowup?: {
    incidentId: string;
    /** Only an actual delivered/read receipt starts the silence clock. */
    messageDeliveredAt?: number;
    messageFailed: boolean;
    completed: boolean;
  };
}
export interface LogisticsDraftPolicy {
  maxSnapshotAgeMs: number;
  incidentFollowupDelayMs: number;
  supplierDelayMs: number;
  /** No default cancellation deadline: existing confirmation process owns it. */
  cancelAfterExhaustion: boolean;
}
export const LOGISTICS_DRAFT_POLICY: Readonly<LogisticsDraftPolicy> =
  Object.freeze({
    maxSnapshotAgeMs: 15 * 60_000,
    incidentFollowupDelayMs: 3 * 60 * 60_000,
    supplierDelayMs: 24 * 60 * 60_000,
    cancelAfterExhaustion: false,
  });
export type LogisticsProposal =
  | 'observe'
  | 'stop'
  | 'review'
  | 'continue_confirmation'
  | 'dispatch_existing'
  | 'cancel_existing'
  | 'draft_incident_message'
  | 'draft_incident_call'
  | 'review_message_delivery'
  | 'review_supplier_delay';
export interface LogisticsDraftDecision {
  mode: 'draft';
  executable: false;
  proposal: LogisticsProposal;
  reason: string;
  /** Candidate key for a future transactional outbox, NOT a durable claim. */
  dedupeKey: string;
}

export function planLogisticsDraft(
  s: LogisticsSnapshot,
  now: number,
  policy: Readonly<LogisticsDraftPolicy> = LOGISTICS_DRAFT_POLICY
): LogisticsDraftDecision {
  const decision = (
    proposal: LogisticsProposal,
    reason: string
  ): LogisticsDraftDecision => ({
    mode: 'draft',
    executable: false,
    proposal,
    reason,
    dedupeKey: JSON.stringify([
      'logistics-v1',
      s.workspaceId,
      s.orderId,
      s.revision,
      s.incident?.id ?? null,
      proposal,
    ]),
  });
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(s.observedAt) ||
    s.observedAt > now ||
    !Number.isFinite(s.stageSince) ||
    s.stageSince > now ||
    !Number.isFinite(policy.maxSnapshotAgeMs) ||
    policy.maxSnapshotAgeMs <= 0 ||
    !Number.isFinite(policy.incidentFollowupDelayMs) ||
    policy.incidentFollowupDelayMs <= 0 ||
    !Number.isFinite(policy.supplierDelayMs) ||
    policy.supplierDelayMs <= 0
  ) {
    return decision('review', 'invalid_clock_or_policy');
  }
  if (!s.workspaceId || !s.orderId || !s.revision || !s.identityVerified)
    return decision('review', 'unverified_order');
  if (now - s.observedAt > policy.maxSnapshotAgeMs)
    return decision('review', 'stale_snapshot');
  if (['delivered', 'cancelled', 'returned'].includes(s.stage))
    return decision('stop', 'terminal_order');
  if (s.optedOut || s.evidence?.decision === 'opt_out')
    return decision('stop', 'contact_opted_out');
  if (s.humanReview || s.stage === 'unknown')
    return decision('review', 'human_review_required');
  if (s.callPending) return decision('observe', 'await_call_result');
  const e = s.evidence;
  if (
    e &&
    (e.workspaceId !== s.workspaceId ||
      e.orderId !== s.orderId ||
      e.revision !== s.revision ||
      !e.evidenceId ||
      !Number.isFinite(e.at) ||
      e.at > now)
  )
    return decision('review', 'invalid_confirmation_evidence');
  if (
    s.latestCustomerReplyAt !== undefined &&
    (!Number.isFinite(s.latestCustomerReplyAt) || s.latestCustomerReplyAt > now)
  )
    return decision('review', 'invalid_reply_time');
  if (
    s.latestCustomerReplyAt !== undefined &&
    (!e || s.latestCustomerReplyAt > e.at)
  ) {
    return decision('review', 'customer_replied_reconcile_first');
  }
  if (e?.decision === 'needs_review')
    return decision('review', 'customer_requested_change');
  const beforeShipment = ['pending_confirmation', 'confirmed'].includes(
    s.stage
  );
  if (e?.decision === 'cancelled')
    return decision(
      beforeShipment && s.canCancelExisting ? 'cancel_existing' : 'review',
      beforeShipment ? 'customer_cancelled' : 'return_requires_separate_process'
    );
  if (beforeShipment) {
    if (e?.decision === 'confirmed') {
      return decision(
        s.dataComplete && s.stockVerified && s.canDispatchExisting
          ? 'dispatch_existing'
          : 'review',
        s.dataComplete && s.stockVerified && s.canDispatchExisting
          ? 'explicit_confirmation'
          : 'dispatch_requirements_missing'
      );
    }
    const f = s.confirmation;
    if (f.deliveryFailureUnresolved)
      return decision(
        'review_message_delivery',
        'failure_is_not_customer_silence'
      );
    if (
      f.completed &&
      f.allAttemptsAccountedFor &&
      Number.isFinite(f.finalWaitUntil) &&
      now >= f.finalWaitUntil! &&
      policy.cancelAfterExhaustion &&
      s.canCancelExisting
    ) {
      return decision('cancel_existing', 'confirmation_exhausted');
    }
    return decision('continue_confirmation', 'confirmation_not_resolved');
  }
  const incident = s.incident;
  if (
    incident &&
    !incident.resolved &&
    incident.verified &&
    incident.requiresAction &&
    ['dropi_incidents', 'carrier_incidents'].includes(incident.source)
  ) {
    if (
      !incident.id ||
      !Number.isFinite(incident.openedAt) ||
      incident.openedAt > now ||
      (incident.deadlineAt !== undefined &&
        !Number.isFinite(incident.deadlineAt))
    ) {
      return decision('review', 'invalid_incident');
    }
    if (incident.kind === 'unknown' || incident.kind === 'customer_rejected')
      return decision('review', 'incident_needs_human_review');
    if (incident.deadlineAt !== undefined && now >= incident.deadlineAt)
      return decision('review', 'incident_deadline_reached');
    const f =
      s.incidentFollowup?.incidentId === incident.id
        ? s.incidentFollowup
        : undefined;
    if (f?.completed) return decision('review', 'incident_followup_exhausted');
    if (f?.messageFailed)
      return decision('review_message_delivery', 'incident_message_failed');
    if (f?.messageDeliveredAt === undefined)
      return decision('draft_incident_message', 'official_actionable_incident');
    if (
      !Number.isFinite(f.messageDeliveredAt) ||
      f.messageDeliveredAt < incident.openedAt ||
      f.messageDeliveredAt > now
    )
      return decision('review', 'invalid_delivery_receipt');
    if (
      s.latestCustomerReplyAt !== undefined &&
      s.latestCustomerReplyAt >= f.messageDeliveredAt
    ) {
      return decision('review', 'incident_customer_replied');
    }
    return decision(
      now - f.messageDeliveredAt >= policy.incidentFollowupDelayMs
        ? 'draft_incident_call'
        : 'observe',
      'incident_waiting_for_reply'
    );
  }
  if (
    ['awaiting_supplier', 'label_created', 'awaiting_collection'].includes(
      s.stage
    ) &&
    now - s.stageSince >= policy.supplierDelayMs
  ) {
    return decision('review_supplier_delay', 'no_collection_confirmed');
  }
  return decision(
    'observe',
    s.retryScheduled
      ? 'carrier_retry_pending'
      : 'no_official_actionable_incident'
  );
}

/** Only a completed, order-bound confirmation call supplies decision evidence.
 * A recovery/incident call must not accidentally confirm another shipment.
 */
export function confirmationFromVoice(
  input: OrderIdentity & {
    callId: string;
    purpose: 'confirmation' | 'incident';
    status: VoiceCallStatus;
    outcome: VoiceCallOutcome | null;
    endedAt: number;
  }
): ConfirmationEvidence | null {
  if (
    input.status !== 'completed' ||
    input.purpose !== 'confirmation' ||
    !input.callId ||
    !input.workspaceId ||
    !input.orderId ||
    !input.revision ||
    !Number.isFinite(input.endedAt)
  )
    return null;
  const mapping: Partial<
    Record<VoiceCallOutcome, ConfirmationEvidence['decision']>
  > = {
    confirmed: 'confirmed',
    recovered: 'confirmed',
    cancelled_by_customer: 'cancelled',
    opt_out: 'opt_out',
    declined: 'needs_review',
    callback_requested: 'needs_review',
    rescheduled: 'needs_review',
    transferred: 'needs_review',
  };
  const result = input.outcome ? mapping[input.outcome] : undefined;
  return result
    ? {
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        revision: input.revision,
        evidenceId: input.callId,
        channel: 'voice',
        decision: result,
        at: input.endedAt,
      }
    : null;
}

/** Context for a future incident call. Never passed to the live queue here. */
export function incidentCallDraftContext(
  s: LogisticsSnapshot
): Record<string, unknown> | null {
  if (
    !s.incident?.verified ||
    !s.incident.requiresAction ||
    s.incident.resolved ||
    !s.incident.id
  )
    return null;
  return {
    order_id: s.orderId,
    incident_id: s.incident.id,
    incident_kind: s.incident.kind,
    cod_writeback: false,
    skip_if_replied: true,
    __logistics: {
      mode: 'draft',
      workspace_id: s.workspaceId,
      revision: s.revision,
    },
  };
}
