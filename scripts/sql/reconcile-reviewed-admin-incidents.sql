-- Reviewed 2026-09-27. Evidence-based closure only; no replay or deletion.
-- Safe to repeat: every update targets an unresolved record and preserves
-- its original failure in the review detail.
BEGIN;

-- The purchase dispatcher cancels pending cart reminders for the same contact.
-- Reviewed cart logs were incorrectly classified by the orphan job.
WITH evidence AS (
  SELECT DISTINCT ON (l.id) l.id, o.id AS order_id
  FROM automation_logs l
  JOIN automations a ON a.id=l.automation_id AND a.workspace_id=l.workspace_id
  JOIN automation_pending_executions p ON p.log_id=l.id
  JOIN orders o ON o.workspace_id=l.workspace_id AND o.contact_id=l.contact_id
  WHERE l.id IN ('102d3162-ea96-4459-8984-5b1c5631b1aa',
    '8cf8fd97-0044-42d0-9dcd-c0229f0a3484','18b12fcf-0801-4f38-97cc-c7d76860f3d8',
    '9b7f8f6b-2844-4571-bb05-3018a48bd06b','b2ccbd81-7da8-4853-a20c-794fcd99e6d0',
    'ea7dab36-b303-4aa8-be27-5d6170c86d89','d3cccc07-c40a-48ec-a8fe-113ef31bdf2f',
    '4b9f0827-5a67-45ff-a60d-e1dda778a8e1','b2a28a2a-90ea-4465-92b4-d9bc8068b53a',
    '02ba3404-d604-4876-aeda-d6c1a592a7e2','036e3d1b-b3db-40e5-a50a-1b61fc152e4b')
    AND a.trigger_type='shopify_abandoned_checkout'
    AND ((l.status='failed' AND l.error_message='Interrupted execution requires review; no message replayed')
      OR (l.id IN ('02ba3404-d604-4876-aeda-d6c1a592a7e2','036e3d1b-b3db-40e5-a50a-1b61fc152e4b')
        AND l.status='partial' AND l.error_message IS NULL))
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

-- An inbound reply deliberately stopped this confirmation sequence.
UPDATE automation_logs l SET status='success',error_message=NULL,
  steps_executed=l.steps_executed||jsonb_build_array(jsonb_build_object(
    'step_id',l.id::text,'step_type','wait','status','skipped',
    'detail','Reviewed: cancelled by inbound reply; previous orphan classification was incorrect; no replay',
    'reviewed_at',now()))
WHERE l.id='981f86e3-e6b3-4e42-a04f-0c656dce5115' AND l.status='failed'
  AND l.error_message='Interrupted execution requires review; no message replayed'
  AND l.steps_executed->-1->>'status'='skipped'
  AND l.steps_executed->-1->>'detail'='cancelled by inbound reply'
  AND NOT EXISTS (SELECT 1 FROM automation_pending_executions p
    WHERE p.log_id=l.id AND p.status IN ('pending','running','failed'))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l.steps_executed) s WHERE s->>'status'='failed');

-- Product identities are globally assigned by Shopify. Require every stored
-- copy to contain a provider revision at least as new as the missed update.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: recovered by product sync; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='shopify:products/update'
  AND EXISTS (SELECT 1 FROM shopify_products p WHERE p.external_id::text=e.raw_body::jsonb->>'id')
  AND NOT EXISTS (SELECT 1 FROM shopify_products p WHERE p.external_id::text=e.raw_body::jsonb->>'id'
    AND (p.synced_at IS NULL OR p.synced_at<e.received_at
      OR nullif(p.raw->>'updated_at','') IS NULL
      OR nullif(p.raw->>'updated_at','')::timestamptz<nullif(e.raw_body::jsonb->>'updated_at','')::timestamptz))
  AND nullif(e.raw_body::jsonb->>'updated_at','') IS NOT NULL;

UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: public visibility already reflected in all matching workspaces'
WHERE e.processed_at IS NULL AND e.provider='tiktok' AND e.last_error IS NULL
  AND (e.raw_body::jsonb->>'content')::jsonb->>'comment_action'='set_to_public'
  AND EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='tiktok_comment'
    AND c.config->>'business_id'=e.raw_body::jsonb->>'user_openid')
  AND NOT EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='tiktok_comment'
    AND c.config->>'business_id'=e.raw_body::jsonb->>'user_openid'
    AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
      WHERE cv.workspace_id=c.workspace_id AND m.channel='tiktok_comment'
        AND m.message_id=(e.raw_body::jsonb->>'content')::jsonb->>'comment_id'
        AND m.is_hidden=false AND m.status<>'failed'));

-- Replay only stored read receipts, with exact phone/workspace/message scope.
-- No sender or automation runs. Only advance delivery status.
WITH receipts AS (
  SELECT e.id event_id,v->'metadata'->>'phone_number_id' phone_id,s->>'id' message_id
  FROM webhook_events_raw e
  CROSS JOIN LATERAL jsonb_array_elements(e.raw_body::jsonb->'entry') a
  CROSS JOIN LATERAL jsonb_array_elements(a->'changes') c
  CROSS JOIN LATERAL (SELECT c->'value' v) x
  CROSS JOIN LATERAL jsonb_array_elements(v->'statuses') s
  WHERE e.processed_at IS NULL AND e.provider='channels:whatsapp' AND s->>'status'='read'
), targets AS (
  SELECT DISTINCT m.id FROM receipts r JOIN channel_connections cc
    ON cc.channel='whatsapp' AND cc.external_account_id=r.phone_id
  JOIN conversations cv ON cv.workspace_id=cc.workspace_id
  JOIN messages m ON m.conversation_id=cv.id AND m.channel='whatsapp' AND m.message_id=r.message_id
)
UPDATE messages m SET status='read',delivery_unconfirmed_at=NULL,held_for_quality=false
FROM targets t WHERE m.id=t.id AND m.status IN ('sending','sent','delivered');

UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: read receipts reflected in all matching workspaces; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='channels:whatsapp'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'changes') c,
    LATERAL jsonb_array_elements(c->'value'->'statuses') s, channel_connections cc
    WHERE cc.channel='whatsapp'
      AND cc.external_account_id=c->'value'->'metadata'->>'phone_number_id'
      AND s->>'status'='read')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'changes') c
    WHERE coalesce(jsonb_array_length(c->'value'->'messages'),0)>0
      OR NOT (c->'value' ? 'statuses'))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'changes') c,
    LATERAL jsonb_array_elements(c->'value'->'statuses') s
    WHERE s->>'status'<>'read'
      OR NOT EXISTS (SELECT 1 FROM channel_connections cc WHERE cc.channel='whatsapp'
        AND cc.external_account_id=c->'value'->'metadata'->>'phone_number_id')
      OR EXISTS (SELECT 1 FROM channel_connections cc WHERE cc.channel='whatsapp'
        AND cc.external_account_id=c->'value'->'metadata'->>'phone_number_id'
        AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
          WHERE cv.workspace_id=cc.workspace_id AND m.channel='whatsapp'
            AND m.message_id=s->>'id' AND m.status='read')));

-- Facebook reaction notifications are deliberately ignored by this adapter.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: ignored Facebook reaction notification; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='channels:fb_comment'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'changes') c WHERE c->'value'->>'item'='reaction')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a
    WHERE a ? 'messaging' OR NOT (a ? 'changes'))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'changes') c WHERE c->'value'->>'item' IS DISTINCT FROM 'reaction');

-- Both missed Instagram echoes are already stored. Verify every account copy.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: Instagram echoes already stored; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='channels:instagram'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'messaging') b, channel_connections cc
    WHERE cc.channel='instagram' AND cc.external_account_id=a->>'id' AND cc.created_at<=e.received_at
      AND b->'message'->>'is_echo'='true')
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a
    WHERE a ? 'changes' OR NOT (a ? 'messaging'))
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.raw_body::jsonb->'entry') a,
    LATERAL jsonb_array_elements(a->'messaging') b
    WHERE b->'message'->>'is_echo' IS DISTINCT FROM 'true'
      OR NOT EXISTS (SELECT 1 FROM channel_connections cc WHERE cc.channel='instagram' AND cc.external_account_id=a->>'id' AND cc.created_at<=e.received_at)
      OR EXISTS (SELECT 1 FROM channel_connections cc WHERE cc.channel='instagram' AND cc.external_account_id=a->>'id' AND cc.created_at<=e.received_at
        AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
          WHERE cv.workspace_id=cc.workspace_id AND m.channel='instagram' AND m.message_id=b->'message'->>'mid')));

UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: question and seller answer already stored; previous: '||coalesce(e.last_error,'')
WHERE e.processed_at IS NULL AND e.provider='mercadolibre:token' AND e.raw_body::jsonb->>'topic'='questions'
  AND EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='mercadolibre'
    AND c.config->>'seller_id'=e.raw_body::jsonb->>'user_id')
  AND NOT EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='mercadolibre'
    AND c.config->>'seller_id'=e.raw_body::jsonb->>'user_id'
    AND (NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
      WHERE cv.workspace_id=c.workspace_id AND m.channel='mercadolibre'
        AND m.message_id='q:'||split_part(e.raw_body::jsonb->>'resource','/',3))
      OR NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
        WHERE cv.workspace_id=c.workspace_id AND m.channel='mercadolibre'
          AND m.message_id='a:'||split_part(e.raw_body::jsonb->>'resource','/',3))));

COMMIT;
