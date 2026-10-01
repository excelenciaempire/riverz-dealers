module.exports = (async () => {
 if (!process.env.RENDER && process.env.BROADCAST_DRAFT_REQUIRE_SCHEMA !== 'true') return;
 const key = process.env.SUPABASE_SERVICE_ROLE_KEY, base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
 const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
 const table = await fetch(`${base}/broadcasts?select=id,draft_review&limit=0`, { headers, signal: AbortSignal.timeout(15000) });
 if (!table.ok) throw new Error(`Apply migration 325 before deploying editable campaign drafts (HTTP ${table.status}).`);
 for (const [name, body] of [
  ['save_broadcast_draft', { p_workspace_id: null, p_broadcast_id: null, p_actor_id: null, p_expected_updated_at: null, p_config: null, p_recipients: null, p_template: null }],
  ['launch_reviewed_broadcast_draft', { p_workspace_id: null, p_broadcast_id: null, p_actor_id: null, p_expected_updated_at: null }],
 ]) {
  const r = await fetch(`${base}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const error = await r.json().catch(() => null);
  if (r.ok || error?.code !== 'P0001' || error?.message !== 'broadcast_draft_invalid') throw new Error(`Campaign draft RPC unavailable (HTTP ${r.status}).`);
 }
 console.log('Editable campaign draft schema and RPCs verified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
