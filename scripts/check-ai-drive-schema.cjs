if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  (async () => {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/ai_drive_sync_ready`, {
      method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: '{}', signal: AbortSignal.timeout(15000),
    });
    if (!result.ok || await result.json().catch(() => null) !== true) throw new Error('Apply migration 345 before deploying Google Drive synchronization.');
    console.log('Drive synchronization schema and private permissions verified without reading document or credential data.');
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
