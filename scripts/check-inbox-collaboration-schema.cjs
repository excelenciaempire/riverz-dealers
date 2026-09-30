(async () => {
  if (!process.env.RENDER && process.env.INBOX_COLLABORATION_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const table of ['conversation_notes?select=id,body,mentioned_user_ids', 'conversation_presence?select=session_id,version,expires_at',
    'workspace_notifications?select=note_id,read_at', 'conversations?select=case_priority,case_reason', 'inbox_saved_filters?select=is_shared', 'conversation_links?select=unlinked_at,linked_by']) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Apply migration 304 before deploying inbox collaboration (HTTP ${response.status}).`);
  }
  console.log('Inbox collaboration schema verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
