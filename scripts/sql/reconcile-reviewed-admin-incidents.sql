-- Reviewed 2026-09-27. Evidence-based closure only; no replay or deletion.
-- Safe to repeat: every update targets an unresolved record and preserves
-- its original failure in the review detail.
BEGIN;

-- The purchase dispatcher cancels pending cart reminders for the same contact.
-- These five reviewed logs were incorrectly classified by the orphan job.
WITH evidence AS (
  SELECT DISTINCT ON (l.id) l.id, o.id AS order_id
  FROM automation_logs l
  JOIN automations a ON a.id=l.automation_id AND a.workspace_id=l.workspace_id
  JOIN automation_pending_executions p ON p.log_id=l.id
  JOIN orders o ON o.workspace_id=l.workspace_id AND o.contact_id=l.contact_id
  WHERE l.id IN ('102d3162-ea96-4459-8984-5b1c5631b1aa',
    '8cf8fd97-0044-42d0-9dcd-c0229f0a3484','18b12fcf-0801-4f38-97cc-c7d76860f3d8',
    '9b7f8f6b-2844-4571-bb05-3018a48bd06b','b2ccbd81-7da8-4853-a20c-794fcd99e6d0')
    AND a.trigger_type='shopify_abandoned_checkout'
    AND l.status='failed'
    AND l.error_message='Interrupted execution requires review; no message replayed'
    AND p.status='done' AND o.created_at>=l.created_at AND o.created_at<p.run_at
    AND NOT EXISTS (SELECT 1 FROM automation_pending_executions q
      WHERE q.log_id=l.id AND q.status IN ('pending','running','failed'))
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l.steps_executed) s WHERE s->>'status'='failed')
  ORDER BY l.id,o.created_at
)
UPDATE automation_logs l SET status='success',error_message=NULL,
  steps_executed=coalesce(l.steps_executed,'[]'::jsonb)||jsonb_build_array(jsonb_build_object(
    'step_id',e.order_id::text,'step_type','wait','status','skipped',
    'detail','Reviewed: cancelled by purchase; previous orphan classification was incorrect; no replay',
    'reviewed_at',now()))
FROM evidence e WHERE l.id=e.id;

-- Only order notifications with an exact seller/order match, a later stored
-- order and an advanced provider sync cursor. Claims/messages stay pending.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: recovered by order sync; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='mercadolibre:token'
  AND e.raw_body::jsonb->>'topic'='orders_v2'
  AND EXISTS (
    SELECT 1 FROM orders o JOIN channel_connections c ON c.workspace_id=o.workspace_id
    WHERE c.channel='mercadolibre' AND c.status='connected'
      AND c.config->>'seller_id'=e.raw_body::jsonb->>'user_id'
      AND nullif(c.config->>'orders_cursor','')::timestamptz>=e.received_at
      AND o.platform='mercadolibre'
      AND o.shop_domain='mercadolibre:'||(e.raw_body::jsonb->>'user_id')
      AND o.shopify_order_id=split_part(e.raw_body::jsonb->>'resource','/',3)
      AND o.updated_at>=e.received_at
  );

-- These topics are explicitly not consumed by the inbox adapter. Record the
-- disposition honestly as ignored, not recovered. Keep the original payload.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: ignored unsupported topic; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='mercadolibre:token'
  AND e.last_error='[mercadolibre] connection missing refresh_token'
  AND e.raw_body::jsonb->>'topic' IN ('payments','items','user_products','stock-locations','public_candidates');

-- TikTok inserts already present in EVERY matching workspace are recovered.
-- Visibility/deletion changes are deliberately excluded; existence alone
-- cannot prove their lifecycle effect was applied.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: comment already ingested in all matching workspaces; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='tiktok' AND e.last_error IS NULL
  AND e.raw_body::jsonb->>'event'='comment.update'
  AND (e.raw_body::jsonb->>'content')::jsonb->>'comment_action'='insert'
  AND EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='tiktok_comment'
    AND c.config->>'business_id'=e.raw_body::jsonb->>'user_openid')
  AND NOT EXISTS (
    SELECT 1 FROM channel_connections c WHERE c.channel='tiktok_comment'
      AND c.config->>'business_id'=e.raw_body::jsonb->>'user_openid'
      AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
        WHERE cv.workspace_id=c.workspace_id AND m.channel='tiktok_comment'
          AND m.message_id=(e.raw_body::jsonb->>'content')::jsonb->>'comment_id')
  );

COMMIT;
