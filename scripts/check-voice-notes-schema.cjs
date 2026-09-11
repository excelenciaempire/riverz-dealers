(async () => {
  if (!process.env.RENDER && process.env.VOICE_NOTES_REQUIRE_SCHEMA !== 'true')
    return;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const [table, field] of [
    ['voice_note_templates', 'config'],
    ['ai_agents', 'voice_note'],
    ['broadcasts', 'voice_note'],
    ['ai_pending_replies', 'voice_note'],
  ]) {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=${field}&limit=0`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!response.ok)
      throw new Error(
        `Apply migration 256 before deploying voice notes (${table}: HTTP ${response.status}).`
      );
  }
  console.log('Voice notes schema verified.');
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
