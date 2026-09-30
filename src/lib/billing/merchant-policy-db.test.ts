import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const ws='00000000-0000-4000-8000-000000000001', actor='00000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE workspaces(id uuid PRIMARY KEY,deleted_at timestamptz);
    CREATE TABLE billing_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,nombre text,activo boolean,precio_centavos int,moneda text,incluidas int,excedente_centavos int,orden int);
    CREATE TABLE workspace_subscriptions(workspace_id uuid PRIMARY KEY,plan_id uuid,estado text,precio_centavos_override int,nota text,vencida_desde timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE wallet_accounts(workspace_id uuid PRIMARY KEY REFERENCES workspaces,saldo_centavos bigint DEFAULT 0,bloquear_sin_saldo boolean DEFAULT false,descubierto_centavos int DEFAULT 200,cobrar_a_costo boolean DEFAULT false,auto_recarga_centavos bigint,auto_umbral_centavos bigint,updated_at timestamptz DEFAULT now());
    CREATE TABLE wallet_movimientos(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,tipo text,concepto text,centavos bigint,saldo_despues_centavos bigint,costo_centavos numeric,cantidad numeric,referencia_tipo text,referencia_id text,detalle jsonb,stripe_id text,creado_por uuid,creado_en timestamptz DEFAULT now());
    CREATE TABLE admin_audit_log(actor_id uuid,actor_email text NOT NULL,action text,target_type text,target_id text,meta jsonb);
    CREATE TABLE workspace_billing_notices(id uuid DEFAULT gen_random_uuid(),workspace_id uuid,invoice_id text,phase text,channel text,recipient text,status text,lease_id uuid,lease_until timestamptz,UNIQUE(workspace_id,invoice_id,phase,channel,recipient));
    INSERT INTO billing_plans(id,activo,orden) VALUES('00000000-0000-4000-8000-000000000099',true,1);
    INSERT INTO workspaces(id) VALUES('${ws}');
    INSERT INTO workspace_subscriptions(workspace_id,estado) VALUES('${ws}','activa');
    INSERT INTO wallet_accounts(workspace_id,saldo_centavos) VALUES('${ws}',10000);`);
  for (const file of ['253_wallet_provider_usage.sql','263_modelo_cobro_oficial.sql','274_billing_byok.sql','294_wallet_financial_costs.sql','305_subscription_payment_grace.sql','315_per_merchant_billing_policy.sql','316_billing_grace_notice_cycles.sql']) {
    try { await db.exec(readFileSync('supabase/migrations/'+file,'utf8')); }
    catch (e) { const err=e as Error & { position?: string; internalPosition?: string; internalQuery?: string }; throw new Error(file+': '+err.message+' at '+err.position+' '+err.internalPosition+' '+err.internalQuery); }
  }
  await db.exec('select activate_billing_notice_schedules()');
},30000);
afterAll(async()=>db.close());
const value=async(sql:string)=>Object.values((await db.query<Record<string,unknown>>(sql)).rows[0])[0];
const invoice=async(id:string,status='open',hoursAgo=25)=>db.query('select record_subscription_invoice($1::jsonb)',[JSON.stringify({
  invoice_id:id,workspace_id:ws,subscription_id:'sub',customer_id:'cus',status,amount_remaining:status==='paid'?0:9900,
  currency:'usd',unpaid_since:new Date(Date.now()-hoursAgo*3_600_000).toISOString(),
})]);
const adjust=(id:string,cents:number,reason:string|null='Corrección')=>db.query('select * from admin_adjust_wallet($1,$2,$3,$4,$5,$6,$7)',
  [ws,cents,id,actor,reason,cents<0?'ajuste':'bono','admin@example.com']);

describe('atomic merchant billing policies',()=>{
  it('extends an overdue invoice from its original clock and preserves that deadline on Stripe retries',async()=>{
    await invoice('in_policy');
    expect(await value(`select workspace_billing_write_allowed('${ws}')`)).toBe(false);
    await db.query('select admin_set_billing_grace($1,72,$2,24,$3)',[ws,actor,'admin@example.com']);
    expect(await value(`select workspace_billing_write_allowed('${ws}')`)).toBe(true);
    const deadline=await value("select grace_until from workspace_billing_invoices where invoice_id='in_policy'");
    await invoice('in_policy','open',24);
    expect(await value("select grace_until from workspace_billing_invoices where invoice_id='in_policy'")).toEqual(deadline);
    expect(Number(await value("select extract(epoch from grace_until-unpaid_since)/3600 from workspace_billing_invoices where invoice_id='in_policy'"))).toBe(72);
    await expect(db.query('select admin_set_billing_grace($1,48,$2,24,$3)',[ws,actor,'admin@example.com'])).rejects.toThrow('billing_policy_conflict');
  });
  it.each(['oficial','saldo','byok'])('keeps overdue debt across mode %s and recovers only after payment',async mode=>{
    await db.query('update workspace_subscriptions set modelo_cobro=$1,grace_hours=24 where workspace_id=$2',[mode,ws]);
    expect(await value(`select workspace_billing_write_allowed('${ws}')`)).toBe(false);
    await invoice('in_policy','paid');
    expect(await value(`select workspace_billing_write_allowed('${ws}')`)).toBe(true);
    await db.exec("update workspace_billing_invoices set status='open',amount_remaining=9900 where invoice_id='in_policy'");
  });
  it('leaves paid invoice history unchanged when the grace policy changes',async()=>{
    await invoice('in_policy','paid');
    const deadline=await value("select grace_until from workspace_billing_invoices where invoice_id='in_policy'");
    await db.query('select admin_set_billing_grace($1,48,$2,24,$3)',[ws,actor,'admin@example.com']);
    expect(await value("select grace_until from workspace_billing_invoices where invoice_id='in_policy'")).toEqual(deadline);
  });
  it('keeps credits while atomically disabling auto-recharge when leaving balance mode',async()=>{
    await db.exec(`update workspace_subscriptions set modelo_cobro='saldo' where workspace_id='${ws}';
      update wallet_accounts set auto_recarga_centavos=5000,auto_umbral_centavos=500 where workspace_id='${ws}';`);
    const balance=await value(`select saldo_centavos from wallet_accounts where workspace_id='${ws}'`);
    await db.exec(`update workspace_subscriptions set modelo_cobro='oficial' where workspace_id='${ws}'`);
    expect(await value(`select auto_recarga_centavos from wallet_accounts where workspace_id='${ws}'`)).toBeNull();
    expect(await value(`select saldo_centavos from wallet_accounts where workspace_id='${ws}'`)).toEqual(balance);
  });
  it('allows one reminder per deadline without duplicating the same schedule',async()=>{
    await db.exec(`insert into workspace_billing_notices(workspace_id,invoice_id,phase,channel,recipient,schedule_key)
      values('${ws}','in_policy','reminder6','email','owner@example.com','deadline-24');
      insert into workspace_billing_notices(workspace_id,invoice_id,phase,channel,recipient,schedule_key)
      values('${ws}','in_policy','reminder6','email','owner@example.com','deadline-72');`);
    await expect(db.exec(`insert into workspace_billing_notices(workspace_id,invoice_id,phase,channel,recipient,schedule_key)
      values('${ws}','in_policy','reminder6','email','owner@example.com','deadline-72')`)).rejects.toThrow('billing_notice_schedule_unique');
  });
  it('does not suppress a new pause notice when grace is extended and then restored',async()=>{
    await invoice('in_cycles','open',49);
    await db.exec(`insert into workspace_billing_notices(workspace_id,invoice_id,phase,channel,recipient,status,schedule_key)
      values('${ws}','in_cycles','paused','email','owner@example.com','sent','original-deadline');`);
    await db.query('select admin_set_billing_grace($1,72,$2,48,$3)',[ws,actor,'admin@example.com']);
    expect(String(await value("select schedule_key from workspace_billing_notices where invoice_id='in_cycles'"))).toMatch(/^previous:/);
    await db.query('select admin_set_billing_grace($1,48,$2,72,$3)',[ws,actor,'admin@example.com']);
    await db.exec(`insert into workspace_billing_notices(workspace_id,invoice_id,phase,channel,recipient,status,schedule_key)
      values('${ws}','in_cycles','paused','email','owner@example.com','pending','original-deadline');`);
    expect(Number(await value("select count(*) from workspace_billing_notices where invoice_id='in_cycles'"))).toBe(2);
  });
  it('deducts available funds exactly once and writes the audit in the same transaction',async()=>{
    await db.exec(`update workspace_subscriptions set modelo_cobro='saldo' where workspace_id='${ws}'; update wallet_accounts set reservado_centavos=1000 where workspace_id='${ws}';`);
    const id='00000000-0000-4000-8000-000000000010';
    const result=await adjust(id,-500);
    expect(result.rows[0]).toMatchObject({saldo_centavos:9500,duplicado:false});
    expect((await adjust(id,-500)).rows[0]).toMatchObject({saldo_centavos:9500,duplicado:true});
    expect(Number(await value(`select count(*) from admin_audit_log where meta->>'operationId'='${id}'`))).toBe(1);
    await expect(adjust(id,-501)).rejects.toThrow('billing_adjustment_conflict');
    await expect(adjust('00000000-0000-4000-8000-000000000011',-8501)).rejects.toThrow('billing_insufficient_available_balance');
    expect(Number(await value(`select saldo_centavos from wallet_accounts where workspace_id='${ws}'`))).toBe(9500);
  });
  it.each(['oficial','byok'])('rejects new wallet adjustments in %s',async mode=>{
    await db.query('update workspace_subscriptions set modelo_cobro=$1 where workspace_id=$2',[mode,ws]);
    await expect(adjust('00000000-0000-4000-8000-000000000012',100)).rejects.toThrow('billing_balance_mode_required');
  });
  it.each([['saldo','oficial',true],['saldo','byok',true],['oficial','saldo',false],['byok','saldo',false]] as const)
    ('settles %s → %s against the payer at reservation',async(before,after,charge)=>{
      const id=before+'-'+after;
      await db.query('update workspace_subscriptions set modelo_cobro=$1 where workspace_id=$2',[before,ws]);
      await db.exec(`update wallet_accounts set saldo_centavos=10000,reservado_centavos=0,resto_costo_centavos=0 where workspace_id='${ws}'`);
      expect(await value(`select wallet_reservar('${ws}','${id}','ia_respuesta','anthropic',100)`)).toBe(true);
      await db.query('update workspace_subscriptions set modelo_cobro=$1 where workspace_id=$2',[after,ws]);
      await db.query("select * from wallet_liquidar($1,$2,'ia_respuesta','anthropic',50)",[ws,id]);
      expect(Number(await value(`select saldo_centavos from wallet_accounts where workspace_id='${ws}'`))).toBe(charge?9950:10000);
      await db.query('select wallet_conciliar_recibo($1,$2,70)',['receipt-'+id,id]);
      expect(Number(await value(`select saldo_centavos from wallet_accounts where workspace_id='${ws}'`))).toBe(charge?9930:10000);
    });
  it('uses exclusive admin leases and cannot release another editor’s lease',async()=>{
    const first=await value(`select claim_billing_admin_lease('${ws}')`);
    expect(first).toBeTruthy(); expect(await value(`select claim_billing_admin_lease('${ws}')`)).toBeNull();
    await db.query('select release_billing_admin_lease($1,$2)',[ws,actor]);
    expect(await value(`select claim_billing_admin_lease('${ws}')`)).toBeNull();
    await db.query('select release_billing_admin_lease($1,$2)',[ws,first]);
    expect(await value(`select claim_billing_admin_lease('${ws}')`)).toBeTruthy();
  });
  it('keeps administrative money and policy RPCs private',async()=>{
    expect(await value("select has_function_privilege('authenticated','admin_adjust_wallet(uuid,bigint,uuid,uuid,text,text,text)','EXECUTE')")).toBe(false);
    expect(await value("select has_function_privilege('anon','admin_set_billing_grace(uuid,integer,uuid,integer,text)','EXECUTE')")).toBe(false);
  });
});
