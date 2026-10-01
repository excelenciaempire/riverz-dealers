/** Dry run by default. Run with --env-file=.env.local --import tsx and --apply after deploying the policy handlers. */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { REVITALY_REDIRECT_RULE } from '../src/lib/ai/revitaly-whatsapp-policy';
import { REVITALY_SHIPPING_RULE } from '../src/lib/ai/revitaly-transfer-shipping';
import type { Regla } from '../src/lib/ai/guidance';

const workspaceId = '234604a9-909b-4e50-952b-acde4a85593a';
const agentId = 'b1e7a3c2-5d4f-4a8e-9c21-7f3d2a6b8e01';
const policies = [
  {
    agent_id: null, clave: REVITALY_REDIRECT_RULE,
    titulo: 'Consultas por WhatsApp; Mercado Libre permanece en su plataforma', orden: -5,
    cuando: 'Una consulta nueva llega por Instagram, Facebook, comentarios, correo o chat web; nunca Mercado Libre ni WhatsApp',
    hacer: 'En Instagram, Messenger, comentarios de Facebook o Instagram y chat web, responde brevemente invitando a continuar por el WhatsApp conectado, con su número y enlace. No continúes una venta, no busques pedidos ni pidas datos personales por esos canales. En comentarios, publica solo la invitación; no abras otro privado ni afirmes haber enviado uno. Filtra spam y respeta las conversaciones tomadas por una persona, los cierres y las bajas. En correo conserva los filtros de notificaciones y de respuestas repetidas. EXCEPCIÓN OBLIGATORIA: Mercado Libre se atiende siempre dentro de Mercado Libre; nunca comparte WhatsApp, teléfonos, emails, enlaces externos ni propone pagar fuera. En WhatsApp atiende normalmente y conserva el canal de origen registrado. Esta regla prevalece sobre instrucciones anteriores para continuar ventas por Instagram o Messenger.',
  },
  {
    agent_id: agentId, clave: REVITALY_SHIPPING_RULE,
    titulo: 'Datos escritos para envíos por transferencia', orden: 1,
    cuando: 'En WhatsApp, el cliente elige transferencia a Mercado Pago o envía el comprobante y necesita envío a domicilio',
    hacer: `Comparte primero los datos bancarios si los pide; nunca condiciones el alias a completar la dirección. Para preparar el envío de una compra por transferencia a Mercado Pago, pide los datos por escrito en este orden:
• Nombre y apellido:
• DNI:
• Teléfono:
• Email:
• Calle:
• Número:
• Piso / Dpto (si corresponde):
• Código postal:
• Ciudad / Localidad:
• Provincia:

Indica: «Todos los datos deben enviarse por escrito, completando cada campo correctamente y en el orden solicitado. No aceptamos ubicaciones de Google Maps, enlaces ni ubicación en tiempo real como dirección de envío». Si ya dio datos válidos, pide solo los que falten o deban corregirse. Piso/departamento es opcional. Si envía audio o una ubicación, solicita los campos por escrito; no infieras la dirección ni uses un enlace como calle. Conserva el detalle de piso/departamento cuando exista. No vuelvas a pedir datos de una compra ya entregada ni fuerces domicilio si eligió retiro. No marques el envío como listo mientras falten campos obligatorios. Un comprobante o «ya pagué» no acredita dinero recibido: la verificación del pago continúa con el procedimiento vigente. Nunca modifiques direcciones de pedidos despachados. No aplica a Mercado Libre, que gestiona su propia dirección y envío; tampoco solicites estos datos en público.`,
  },
];

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const before = await db.from('agent_guidance').select('*').eq('workspace_id', workspaceId);
  if (before.error) throw before.error;
  const rules = before.data as Regla[];
  const marketplace = rules.find(r => r.agent_id === 'c2f8b4d3-6e5a-4b9f-8d32-8a4e3b7c9f02'
    && r.titulo === 'Todo dentro de Mercado Libre' && r.activa);
  if (!marketplace) throw new Error('Active Mercado Libre protection not found');
  for (const policy of policies) {
    if (rules.filter(r => r.clave === policy.clave && r.agent_id === policy.agent_id).length > 1)
      throw new Error(`Ambiguous policy: ${policy.clave}`);
  }
  const apply = process.argv.includes('--apply');
  console.log(JSON.stringify({ apply, workspaceId, policies: policies.map(p => ({ clave: p.clave, titulo: p.titulo })), mercadoLibreProtected: true }));
  if (!apply) return;
  mkdirSync('output/revitaly-routing', { recursive: true });
  writeFileSync(`output/revitaly-routing/guidance-before-${Date.now()}.json`, JSON.stringify(rules, null, 2));
  for (const policy of policies) {
    const existing = rules.find(r => r.clave === policy.clave && r.agent_id === policy.agent_id);
    const result = existing
      ? await db.from('agent_guidance').update({ ...policy, activa: true }).eq('workspace_id', workspaceId)
        .eq('id', existing.id).eq('updated_at', existing.updated_at!).select('id').single()
      : await db.from('agent_guidance').insert({ workspace_id: workspaceId, ...policy, activa: true, origen: 'comercio' }).select('id').single();
    if (result.error) throw result.error;
  }
  const comment = rules.find(r => r.id === 'e53cf28f-1017-4251-bf0d-294b458dba66' && r.agent_id === agentId);
  if (comment) {
    const result = await db.from('agent_guidance').update({ hacer: 'Las nuevas consultas de comentarios se continúan por el WhatsApp conectado: publica una invitación breve con número y enlace. No abras un DM de Instagram o Messenger para continuar la venta. No pidas ni publiques datos personales, de pedidos, pagos, direcciones ni transferencia en comentarios. No anuncies un mensaje privado como enviado. El spam y la autopromoción se filtran. Mercado Libre queda excluido: todo se atiende en su plataforma.' })
      .eq('workspace_id', workspaceId).eq('id', comment.id).eq('hacer', comment.hacer).select('id').single();
    if (result.error) throw result.error;
  }
  const saved = await db.from('agent_guidance').select('clave,activa').eq('workspace_id', workspaceId).in('clave', policies.map(p => p.clave));
  if (saved.error || saved.data?.length !== 2 || saved.data.some(r => !r.activa)) throw new Error('Policy activation verification failed');
  console.log(JSON.stringify({ activated: saved.data }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
