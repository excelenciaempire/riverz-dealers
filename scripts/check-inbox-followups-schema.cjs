(async () => {
  if (!process.env.RENDER && process.env.INBOX_FOLLOWUPS_REQUIRE_SCHEMA !== 'true') return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const table of ['conversations?select=snoozed_until,snoozed_at,snoozed_by,snooze_id,assigned_team_id', 'workspace_notifications?select=kind,source_id,body',
    'inbox_reminders?select=id,due_at,status', 'inbox_macros?select=id,actions,version', 'inbox_action_runs?select=id,result',
    'inbox_teams?select=id,enabled', 'inbox_team_members?select=team_id,user_id', 'inbox_agent_state?select=user_id,available,enabled,capacity']) {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}&limit=0`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Apply migration 307 before deploying inbox follow-ups (HTTP ${r.status}).`);
  }
  console.log('Inbox follow-ups schema verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
