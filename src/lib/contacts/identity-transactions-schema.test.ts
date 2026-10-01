import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
const db = new PGlite();
const ws = '11111111-1111-4111-8111-111111111111', foreign = '22222222-2222-4222-8222-222222222222', actor = '33333333-3333-4333-8333-333333333333';
const first = '44444444-4444-4444-8444-444444444444', second = '55555555-5555-4555-8555-555555555555', third = '66666666-6666-4666-8666-666666666666';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,deleted_at timestamptz);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,allowed_sections text[]);
    CREATE TABLE contacts(id uuid PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),phone text,email text,phone_origen text,email_origen text,
      union_bloqueada boolean NOT NULL DEFAULT false,unified_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE billing(allowed boolean);INSERT INTO billing VALUES(true);
    CREATE FUNCTION workspace_billing_write_allowed(ws uuid) RETURNS boolean LANGUAGE sql AS $$SELECT allowed FROM public.billing$$;
    GRANT ALL ON contacts TO authenticated,service_role;GRANT USAGE ON SCHEMA auth TO authenticated,service_role;`);
  await db.exec(readFileSync('supabase/migrations/346_contact_identity_transactions.sql','utf8'));
}, 30_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);TRUNCATE workspaces CASCADE;TRUNCATE workspace_members;UPDATE billing SET allowed=true");
  await db.query('INSERT INTO workspaces VALUES($1,NULL),($2,NULL)',[ws,foreign]);
  await db.query('INSERT INTO workspace_members VALUES($1,$2,NULL)',[ws,actor]);
});
const scalar = async (sql: string,args: unknown[] = []) => Object.values((await db.query<Record<string,unknown>>(sql,args)).rows[0])[0];
async function contact(id = first, extra: { workspace?: string;phone?: string|null;email?: string|null;phoneOrigin?: string|null;emailOrigin?: string|null;blocked?: boolean;primary?: string|null } = {}) {
  await db.query('INSERT INTO contacts(id,workspace_id,phone,email,phone_origen,email_origen,union_bloqueada,unified_contact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id,extra.workspace??ws,extra.phone===undefined?'+573105824679':extra.phone,extra.email===undefined?'ana@example.com':extra.email,
      extra.phoneOrigin===undefined?'canal':extra.phoneOrigin,extra.emailOrigin===undefined?'tienda':extra.emailOrigin,extra.blocked??false,extra.primary??null]);
}
const link = (id = second,workspace = ws) => scalar('SELECT link_verified_contact($1,$2)',[workspace,id]);
const primary = (id = second) => scalar('SELECT read_verified_primary_contact($1,$2)',[ws,id]);
async function human(separate: boolean,id = first) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]); await db.exec('SET ROLE authenticated');
  try { return await scalar('SELECT set_contact_unification_block($1,$2,$3)',[ws,id,separate]); }
  finally { await db.exec("RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false)"); }
}
describe('Atomic identity links and authenticated separation', () => {
  it('keeps the identity audit and automatic linking private', async () => {
    expect(await scalar('SELECT contact_identity_transactions_ready()')).toBe(true); await db.exec('SET ROLE authenticated');
    await expect(db.exec('SELECT * FROM contact_identity_events')).rejects.toThrow('permission denied');
    await expect(db.query('SELECT link_verified_contact($1,$2)',[ws,first])).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE');
  });
  it('links verified identities with stable ordering, audited writes and idempotent replay', async () => {
    await contact(); await contact(second); expect(await link()).toBe(first); expect(await primary()).toMatchObject({id:first,workspace_id:ws});
    expect(await scalar('SELECT count(*) FROM contact_identity_events')).toBe(1); expect(await link()).toBe(first);
    expect(await scalar('SELECT count(*) FROM contact_identity_events')).toBe(1);
    expect((await db.query('SELECT source,actor_id,previous_primary_id,primary_id FROM contact_identity_events')).rows).toEqual([{source:'system',actor_id:null,previous_primary_id:null,primary_id:first}]);
  });
  it.each(['asserted_anchor','asserted_candidate','role_email','placeholder','contradiction','blocked'])('refuses an ambiguous %s identity', async kind => {
    const extra = kind === 'role_email'?{phone:null,email:'info@example.com'}:kind === 'placeholder'?{phone:'0000000000',email:null}:{};
    await contact(first,{...extra,...(kind==='asserted_candidate'?{phoneOrigin:'afirmado',emailOrigin:'afirmado'}:{}),...(kind==='blocked'?{blocked:true}:{})});
    await contact(second,{...extra,...(kind==='asserted_anchor'?{phoneOrigin:'afirmado',emailOrigin:'afirmado'}:{}),...(kind==='contradiction'?{email:'other@example.com'}:{})});
    expect(await link()).toBe(second); expect(await primary()).toBeNull(); expect(await scalar('SELECT count(*) FROM contact_identity_events')).toBe(0);
  });
  it('preserves the explicit legacy origin policy without inventing verification provenance', async () => {
    await contact(first,{phoneOrigin:null,emailOrigin:null}); await contact(second,{phoneOrigin:null,emailOrigin:null}); expect(await link()).toBe(first);
    expect(await scalar('SELECT phone_origen FROM contacts WHERE id=$1',[first])).toBeNull();
  });
  it('normalizes a backed phone while remaining strict about wildcard emails', async () => {
    await contact(first,{phone:'+57 310 582 4679',email:null}); await contact(second,{email:null}); expect(await link()).toBe(first);
    expect(await scalar("SELECT contact_link_email('a_b@example.com','tienda')")).toBeNull();
  });
  it('does not link or read a different business even if identifiers match', async () => {
    await contact(first,{workspace:foreign}); await contact(second); expect(await link()).toBe(second); expect(await primary()).toBeNull();
    await expect(db.query('UPDATE contacts SET unified_contact_id=$1 WHERE id=$2',[first,second])).rejects.toThrow();
    expect(await scalar('SELECT count(*) FROM contact_identity_events')).toBe(0);
  });
  it('does not adopt unverified existing siblings through a verified candidate', async () => {
    await contact(); await contact(second,{primary:first}); await contact(third,{phoneOrigin:'afirmado',emailOrigin:'afirmado',primary:first});
    expect(await link(second)).toBe(second); expect(await primary(third)).toBeNull();expect(await primary(second)).toBeNull();
  });
  it('excludes the entire ambiguous family from primary data and shared model history', async () => {
    await contact(first,{email:null});await contact(second,{primary:first});await contact(third,{email:'other@example.com',primary:first});
    expect(await primary(second)).toBeNull();expect(await scalar('SELECT verified_contact_family($1,$2)',[ws,second])).toEqual([second]);
    expect(await scalar('SELECT verified_contact_family($1,$2)',[ws,first])).toEqual([first]);
  });
  it('keeps authenticated family reads bound to the current member and business', async () => {
    await contact();await contact(second);await link();
    await expect(scalar('SELECT contact_identity_family($1,$2)',[ws,second])).rejects.toThrow('invalid_contact_identity');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('SET ROLE authenticated');
    expect(await scalar('SELECT contact_identity_family($1,$2)',[ws,second])).toEqual([first,second]);
    await expect(scalar('SELECT contact_identity_family($1,$2)',[foreign,first])).rejects.toThrow('invalid_contact_identity');await db.exec('RESET ROLE');
  });
  it('separates a primary and every child atomically with the authenticated actor', async () => {
    await contact(); await contact(second); await contact(third); await link(); await link(third);
    expect(await human(true)).toBe(true); expect(await primary(second)).toBeNull(); expect(await primary(third)).toBeNull();
    expect((await db.query<{unified_contact_id:string|null}>('SELECT unified_contact_id FROM contacts')).rows.every(row=>row.unified_contact_id===null)).toBe(true);
    expect(await link(second)).toBe(second);
    expect((await db.query("SELECT actor_id FROM contact_identity_events WHERE source='human'")).rows).toHaveLength(3);
    expect((await db.query<{actor_id:string|null}>("SELECT actor_id FROM contact_identity_events WHERE source='human'")).rows.every(row=>row.actor_id===actor)).toBe(true);
  });
  it('unblocking only permits a new verified transaction and does not override other blocked contacts', async () => {
    await contact(first,{blocked:true}); await contact(second,{blocked:true}); expect(await human(false)).toBe(false);
    expect(await primary(second)).toBeNull(); expect(await human(false,second)).toBe(false); expect(await primary(second)).toMatchObject({id:first});
  });
  it.each(['absent','membership','section','billing'])('denies an invalid %s manual mutation without partial changes', async kind => {
    await contact(); await contact(second); await link();
    if(kind==='membership') await db.exec('DELETE FROM workspace_members');
    if(kind==='section') await db.exec("UPDATE workspace_members SET allowed_sections=ARRAY['/pedidos']");
    if(kind==='billing') await db.exec('UPDATE billing SET allowed=false');
    if(kind==='absent') await expect(scalar('SELECT set_contact_unification_block($1,$2,true)',[ws,first])).rejects.toThrow('invalid_contact_identity');
    else await expect(human(true)).rejects.toThrow(kind==='billing'?'subscription_read_only':'invalid_contact_identity');
    expect(await primary(second)).toMatchObject({id:first});
  });
  it('denies direct authenticated link updates but preserves ordinary contact writes', async () => {
    await contact(); await contact(second); await db.exec('SET ROLE authenticated');
    await db.query('UPDATE contacts SET email=$1 WHERE id=$2',['changed@example.com',second]);
    await expect(db.query('UPDATE contacts SET unified_contact_id=$1 WHERE id=$2',[first,second])).rejects.toThrow('contact_identity_transaction_required');
    await expect(db.query('INSERT INTO contacts(id,workspace_id,unified_contact_id) VALUES($1,$2,$3)',[third,ws,first])).rejects.toThrow('contact_identity_transaction_required');
    await db.exec('RESET ROLE');
  });
  it('preserves ordinary authenticated contact creation and primary deletion semantics', async () => {
    await contact();await contact(second);await link();
    await db.exec('SET ROLE authenticated');await db.query('INSERT INTO contacts(id,workspace_id,email) VALUES($1,$2,$3)',[third,ws,'new@example.com']);await db.exec('RESET ROLE');
    await db.query('DELETE FROM contacts WHERE id=$1',[first]);expect(await scalar('SELECT unified_contact_id FROM contacts WHERE id=$1',[second])).toBeNull();
    expect(await scalar('SELECT count(*) FROM contact_identity_events')).toBe(2);
  });
  it('blocks direct service rewriting of private audit events', async () => {
    await contact();await contact(second);await link();await db.exec('SET ROLE service_role');
    expect(await scalar('SELECT count(*) FROM contact_identity_events')).toBe(1);
    await expect(db.exec('DELETE FROM contact_identity_events')).rejects.toThrow('permission denied');await db.exec('RESET ROLE');
  });
  it('fails its deployment guard if an identity trigger is disabled', async () => {
    await db.exec('ALTER TABLE contacts DISABLE TRIGGER contact_link_write_guard');expect(await scalar('SELECT contact_identity_transactions_ready()')).toBe(false);
    await db.exec('ALTER TABLE contacts ENABLE TRIGGER contact_link_write_guard');expect(await scalar('SELECT contact_identity_transactions_ready()')).toBe(true);
  });
  it('rechecks persisted origins, contradictions and separation for a previously linked primary', async () => {
    await contact(); await contact(second); await link(); await db.exec("UPDATE contacts SET phone_origen='afirmado',email_origen='afirmado' WHERE id='"+second+"'"); expect(await primary()).toBeNull();
    await db.query("UPDATE contacts SET phone_origen='canal',email_origen='tienda',email='other@example.com' WHERE id=$1",[second]); expect(await primary()).toBeNull();
  });
});
