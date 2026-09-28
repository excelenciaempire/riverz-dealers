-- Reviewed 2026-09-27. No outbound replay, deletions or monetary changes.
BEGIN;

-- These are delivery receipts for Riverz's internal approval number, not
-- merchant inbox messages. Verify that ownership in platform settings.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: internal platform WhatsApp read receipt, not merchant inbox; previous: '||coalesce(e.last_error,'')
WHERE e.id IN ('5d8af2ac-7d41-4ac5-b9b3-9a8d4b45577b','0e5a74a4-4cae-4755-8edb-c581d787ca56')
  AND e.processed_at IS NULL AND e.provider='channels:whatsapp'
  AND e.raw_body::jsonb#>>'{entry,0,changes,0,value,statuses,0,status}'='read'
  AND NOT (e.raw_body::jsonb#>'{entry,0,changes,0,value}' ? 'messages')
  AND EXISTS (SELECT 1 FROM platform_whatsapp_settings p
    WHERE p.phone_number_id=e.raw_body::jsonb#>>'{entry,0,changes,0,value,metadata,phone_number_id}');

-- Rasmiaw's echoes are already stored in its current workspace. An old
-- disconnected Rasmiaw connection in Pilar must NOT receive copies.
UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: echo stored in every currently routed workspace; disconnected historical connections excluded; previous: '||coalesce(e.last_error,'')
WHERE e.id IN ('727dea45-3c33-4023-9dcc-8e7b4531177e','396e75f9-0488-4044-b94b-e057670bdf6e')
  AND e.processed_at IS NULL AND e.provider='channels:instagram'
  AND e.raw_body::jsonb#>>'{entry,0,messaging,0,message,is_echo}'='true'
  AND EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='instagram'
    AND c.status IN ('connected','expired','error')
    AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,id}' AND c.created_at<=e.received_at)
  AND NOT EXISTS (SELECT 1 FROM channel_connections c WHERE c.channel='instagram'
    AND c.status IN ('connected','expired','error')
    AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,id}' AND c.created_at<=e.received_at
    AND NOT EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
      WHERE cv.workspace_id=c.workspace_id AND m.channel='instagram' AND m.sender_type IN ('agent','bot')
        AND m.message_id=e.raw_body::jsonb#>>'{entry,0,messaging,0,message,mid}'));

UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: exact merchant comment reply already stored; previous: '||coalesce(e.last_error,'')
WHERE e.id='b50c074b-1ac2-4d14-bc35-f5d8584a6298' AND e.processed_at IS NULL
  AND e.provider='channels:instagram'
  AND e.raw_body::jsonb#>>'{entry,0,changes,0,value,from,id}'=e.raw_body::jsonb#>>'{entry,0,id}'
  AND EXISTS (SELECT 1 FROM channel_connections c JOIN conversations cv ON cv.workspace_id=c.workspace_id
    JOIN messages m ON m.conversation_id=cv.id
    WHERE c.channel='ig_comment' AND c.status IN ('connected','expired','error')
      AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,id}'
      AND m.channel='ig_comment' AND m.sender_type='agent'
      AND m.message_id=e.raw_body::jsonb#>>'{entry,0,changes,0,value,id}'
      AND m.content_text=e.raw_body::jsonb#>>'{entry,0,changes,0,value,text}');

-- Read-by-message-ID is a monotonic delivery update, never an inbox replay.
UPDATE messages m SET status='read',delivery_unconfirmed_at=NULL
FROM conversations cv,channel_connections c,webhook_events_raw e
WHERE e.id='a1b2e893-fd9a-4b9b-b0fb-f9f0aa4dc5da' AND e.processed_at IS NULL
  AND c.channel='instagram' AND c.status IN ('connected','expired','error')
  AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,id}'
  AND cv.workspace_id=c.workspace_id AND cv.id=m.conversation_id
  AND m.channel='instagram' AND m.sender_type IN ('agent','bot')
  AND m.message_id=e.raw_body::jsonb#>>'{entry,0,messaging,0,read,mid}'
  AND m.status IN ('sending','sent','delivered');

UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: exact Instagram read receipt applied; previous: '||coalesce(e.last_error,'')
WHERE e.id='a1b2e893-fd9a-4b9b-b0fb-f9f0aa4dc5da' AND e.processed_at IS NULL
  AND EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
    JOIN channel_connections c ON c.workspace_id=cv.workspace_id
    WHERE c.channel='instagram' AND c.status IN ('connected','expired','error')
      AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,id}' AND m.channel='instagram'
      AND m.message_id=e.raw_body::jsonb#>>'{entry,0,messaging,0,read,mid}' AND m.status='read');

-- The exact reaction target's own customer has the same full AR number,
-- stored without the optional mobile 9. Do not overwrite a newer reaction.
INSERT INTO message_reactions(message_id,conversation_id,actor_type,actor_id,emoji,created_at)
SELECT m.id,cv.id,'customer',ct.id,e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,reaction,emoji}',
  to_timestamp((e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,timestamp}')::bigint)
FROM webhook_events_raw e
JOIN channel_connections c ON c.channel='whatsapp' AND c.status IN ('connected','expired','error')
  AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,changes,0,value,metadata,phone_number_id}'
JOIN conversations cv ON cv.workspace_id=c.workspace_id
JOIN messages m ON m.conversation_id=cv.id AND m.channel='whatsapp'
  AND m.message_id=e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,reaction,message_id}'
JOIN contacts ct ON ct.id=cv.contact_id AND ct.workspace_id=c.workspace_id AND ct.channel='whatsapp'
WHERE e.id='0bcc595f-5f00-4167-9a08-44cee5fea048' AND e.processed_at IS NULL
  AND e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,type}'='reaction'
  AND e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,from}' ~ '^549[0-9]{10}$'
  AND ct.external_id='54'||substring(e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,from}' FROM 4)
ON CONFLICT(message_id,actor_type,actor_id) DO NOTHING;

UPDATE webhook_events_raw e SET processed_at=now(),
  last_error='reviewed: exact WhatsApp reaction restored for the target customer; previous: '||coalesce(e.last_error,'')
WHERE e.id='0bcc595f-5f00-4167-9a08-44cee5fea048' AND e.processed_at IS NULL
  AND EXISTS (SELECT 1 FROM messages m JOIN conversations cv ON cv.id=m.conversation_id
    JOIN channel_connections c ON c.workspace_id=cv.workspace_id
    JOIN message_reactions r ON r.message_id=m.id AND r.actor_id=cv.contact_id AND r.actor_type='customer'
    WHERE c.channel='whatsapp' AND c.status IN ('connected','expired','error')
      AND c.external_account_id=e.raw_body::jsonb#>>'{entry,0,changes,0,value,metadata,phone_number_id}'
      AND m.channel='whatsapp'
      AND m.message_id=e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,reaction,message_id}'
      AND r.emoji=e.raw_body::jsonb#>>'{entry,0,changes,0,value,messages,0,reaction,emoji}');

COMMIT;
