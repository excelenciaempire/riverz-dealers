/** Dry-run by default. Apply the owner's global non-stacking policy with backups. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { NON_STACKING_DISCOUNT_POLICY } from '../src/lib/commerce/discount-policy';

const REVITALY = '234604a9-909b-4e50-952b-acde4a85593a';
const KEY = 'descuentos_no_acumulables';
const transferPolicy =
  'Política confirmada por el dueño el 29/09/2026: las compras por transferencia, también nuevas y fuera de Shopify, tienen 10% OFF sobre el precio vigente del producto. Este beneficio no se acumula con ningún cupón ni otro descuento. Si el cliente elige transferencia con 10% OFF, no agregues REVITALY5, REVITALY10, CLIENTE10 ni otro código. Los cupones elegibles son alternativas al beneficio por transferencia, nunca un descuento adicional. No sumes porcentajes ni los apliques sucesivamente. Verifica el catálogo vigente y agrega al final el envío que corresponda, sin descontarlo. Referencia sin cupones para los precios actuales: 2 meses, producto $49.990 menos $4.999 por transferencia, total $44.991 a sucursal/$46.981 a domicilio; 4 meses, producto $61.990 menos $6.199, total $55.791/$57.781; 6 meses, producto $71.990 menos $7.199, total $64.791/$66.781; anual, producto $125.990 menos $12.599, total $113.391 con domicilio gratis. Env?o a domicilio $1.990 salvo el anual. Si cambia el catálogo, recalcula antes de pedir pago. Confirma pack y envío sólo si faltan. Titular: Joaquin Federico Guerrero. CVU: 0000003100067538952577. Alias: fede.ecom. Puedes compartirlos cuando los pidan en privado sin exigir la elección del pack. Para solicitar el pago confirma y desglosa producto, único descuento, envío y total. Pide comprobante en foto normal o PDF y sólo los datos de entrega faltantes. Un comprobante o «ya pagué» no acreditan el pago: verifica internamente. No marques pagado, no dupliques pedidos ni prometas despacho sin verificación. No publiques datos bancarios ni promociones pagos externos dentro de Mercado Libre. La revisión es interna; conserva la atención en primera persona.';
const couponPolicy =
  'Cupones conocidos: REVITALY5, 5% sólo primera compra; REVITALY10, 10% para recuperación de carrito y un uso por cliente; CLIENTE10, 10% para recompra, cliente con compra previa y un uso por cliente. La lista no es exhaustiva: verifica las condiciones vigentes de cualquier código de Shopify antes de cotizar; no rechaces uno sólo porque no aparece aquí. Nunca combines varios cupones ni un cupón con el descuento del 10% por transferencia u otro descuento. Ofrece beneficios como alternativas y aplica únicamente el elegido que resulte elegible. No inventes códigos, vencimientos ni descuentos y no anuncies una aplicación en Shopify sin confirmación de la herramienta. No reutilices los totales antiguos que combinaban cupón y transferencia.';

interface Rule {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  titulo: string;
  hacer: string;
  clave: string | null;
  activa: boolean;
  updated_at: string;
}
interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  knowledge: string | null;
  updated_at: string;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase configuration');
  const db = createClient(url, key, { auth: { persistSession: false } });
  const [ws, guidance, agents] = await Promise.all([
    db.from('workspaces').select('id,name').is('deleted_at', null),
    db.from('agent_guidance').select('*'),
    db
      .from('ai_agents')
      .select('id,workspace_id,name,knowledge,updated_at')
      .eq('workspace_id', REVITALY),
  ]);
  if (ws.error || guidance.error || agents.error)
    throw ws.error ?? guidance.error ?? agents.error;
  const rules = guidance.data as Rule[];
  const patches = rules
    .filter((r) => r.workspace_id === REVITALY)
    .flatMap((r) => {
      let hacer = r.hacer;
      if (r.titulo === 'Transferencia') hacer = transferPolicy;
      if (r.titulo === 'Descuentos y cupón') hacer = couponPolicy;
      if (r.titulo === 'Atención contextual y breve')
        hacer = hacer.replace(
          'Conserva los cupones Shopify elegibles y el 10% por transferencia autorizados; no cambies las condiciones del comercio.',
          'Conserva los cupones Shopify elegibles y el 10% por transferencia como alternativas. Nunca los combines: aplica sólo un descuento y respeta sus condiciones.'
        );
      return hacer === r.hacer ? [] : [{ row: r, hacer }];
    });
  const agentPatches = (agents.data as Agent[]).flatMap((a) => {
    const knowledge = (a.knowledge ?? '')
      .split('\n')
      .map((line) =>
        line.startsWith(
          'Política confirmada por el dueño el 27/09/2026: las compras por transferencia'
        ) ||
        line.startsWith(
          'Política confirmada por el dueño el 29/09/2026: las compras por transferencia'
        )
          ? transferPolicy
          : line
      )
      .join('\n');
    return knowledge === (a.knowledge ?? '') ? [] : [{ row: a, knowledge }];
  });
  const workspaces = ws.data.filter((w) => {
    const existing = rules.find(
      (r) => r.workspace_id === w.id && r.clave === KEY
    );
    return (
      !existing ||
      existing.hacer !== NON_STACKING_DISCOUNT_POLICY ||
      !existing.activa
    );
  });
  console.log(
    JSON.stringify({
      mode: process.argv.includes('--apply') ? 'apply' : 'dry-run',
      globalPolicies: workspaces.length,
      revitalyRules: patches.map((p) => p.row.titulo),
      revitalyAgents: agentPatches.map((p) => p.row.name),
    })
  );
  if (!process.argv.includes('--apply')) return;
  mkdirSync('tmp', { recursive: true });
  const backup = `tmp/discount-policy-backup-${Date.now()}.json`;
  writeFileSync(
    backup,
    JSON.stringify(
      { workspaces: ws.data, guidance: rules, agents: agents.data },
      null,
      2
    ),
    'utf8'
  );
  console.log('Backup:', backup);
  for (const { row, hacer } of patches) {
    const r = await db
      .from('agent_guidance')
      .update({ hacer, updated_at: new Date().toISOString() })
      .eq('workspace_id', REVITALY)
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .select('id');
    if (r.error || r.data?.length !== 1)
      throw r.error ?? new Error(`Concurrent rule update: ${row.titulo}`);
  }
  for (const { row, knowledge } of agentPatches) {
    const r = await db
      .from('ai_agents')
      .update({ knowledge, updated_at: new Date().toISOString() })
      .eq('workspace_id', REVITALY)
      .eq('id', row.id)
      .eq('updated_at', row.updated_at)
      .select('id');
    if (r.error || r.data?.length !== 1)
      throw r.error ?? new Error(`Concurrent agent update: ${row.name}`);
  }
  for (const w of workspaces) {
    const r = await db
      .from('agent_guidance')
      .upsert(
        {
          workspace_id: w.id,
          agent_id: null,
          titulo: 'Descuentos no acumulables',
          cuando: null,
          hacer: NON_STACKING_DISCOUNT_POLICY,
          activa: true,
          orden: 0,
          origen: 'comercio',
          clave: KEY,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,clave' }
      );
    if (r.error) throw r.error;
  }
  const check = await db
    .from('agent_guidance')
    .select('workspace_id,hacer,activa')
    .eq('clave', KEY);
  if (check.error) throw check.error;
  for (const w of ws.data) {
    const r = check.data?.find((r) => r.workspace_id === w.id);
    if (r?.hacer !== NON_STACKING_DISCOUNT_POLICY || !r.activa)
      throw new Error(`Policy readback failed: ${w.id}`);
  }
  console.log(`Verified global policy in ${ws.data.length} active workspaces.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
