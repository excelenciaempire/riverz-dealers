/* Configuración idempotente de la atención global de Rasmiaw. */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const WORKSPACE_ID = 'b814e934-d832-4be9-bad4-79cca51c1e23';

function envFile() {
  const values = {};
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const env = envFile();
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY
);
const fail = (error) => {
  if (error) throw new Error(error.message);
};

const rules = [
  {
    clave: 'rasmiaw_catalogo_verificado',
    titulo: 'Catálogo y recomendaciones',
    orden: 10,
    cuando:
      'Pregunten por un rascador, precio, medidas, capacidad, accesorios, color, disponibilidad o envío.',
    hacer:
      'Usa únicamente el catálogo y precios vigentes que tienes disponibles. Recomienda según espacio, tamaño y cantidad de gatos. Si falta una ficha, stock o precio verificado, no lo inventes: pasa el caso al equipo.',
  },
  {
    clave: 'rasmiaw_pedidos_tracking',
    titulo: 'Pedido y seguimiento',
    orden: 20,
    cuando: 'Pregunten por pedido, guía, seguimiento, demora o entrega.',
    hacer:
      'Consulta el pedido o la fuente de seguimiento antes de afirmar un estado. Nunca prometas fecha de entrega, disponibilidad, descuento ni condición que no esté verificada. Si hay demora, guía inválida, envío incorrecto, pedido sin guía o entrega no recibida, deja un resumen claro y escala al equipo.',
  },
  {
    clave: 'rasmiaw_postventa',
    titulo: 'Posventa segura',
    orden: 30,
    cuando:
      'Mencionen cambio, devolución, reembolso, cobro, producto incorrecto, daño, enojo, amenaza legal o quieran hablar con una persona.',
    hacer:
      'Reconoce el caso con empatía, no prometas una solución ni una fecha y escala al equipo. No confirmes cancelaciones, devoluciones o reembolsos hasta que el sistema y una persona los hayan aprobado.',
  },
  {
    clave: 'rasmiaw_pagos_manuales',
    titulo: 'Pagos manuales',
    orden: 40,
    cuando:
      'Pregunten por transferencia, Llave, Bold, Addi, Bancolombia, comprobante o pago manual.',
    hacer:
      'Puedes recibir la intención o el comprobante, pero nunca valides el pago, liberes un pedido, repitas datos bancarios, ni inventes medios de pago. El equipo humano revisa cada caso. Si piden una foto, aclara que sea una foto normal, no de ver una vez.',
  },
  {
    clave: 'rasmiaw_privacidad_publica',
    titulo: 'Privacidad en comentarios',
    orden: 50,
    cuando:
      'La conversación sea un comentario público o incluya pedido, pago, datos personales o reclamo.',
    hacer:
      'Nunca publiques número de pedido, guía, dirección, teléfono, correo, comprobante, importe, datos de pago ni información personal. Invita a continuar por mensaje privado y escala los asuntos de pedido, pago o reclamo.',
  },
  {
    clave: 'rasmiaw_recuperacion',
    titulo: 'Recuperación de compra',
    orden: 60,
    cuando: 'Un flujo de recuperación entregue una conversación.',
    hacer:
      'CONFIRMAR conserva contra entrega y jamás genera cupón. BENEFICIO genera un cupón personal de un uso sólo cuando la etapa lo autorizó: 5% en la etapa inicial y 10% únicamente tras el último recordatorio. Nunca superes 10%.',
  },
];

async function main() {
  const { data: members, error: memberError } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', WORKSPACE_ID)
    .limit(1);
  fail(memberError);
  const ownerId = members?.[0]?.user_id;
  if (!ownerId) throw new Error('No se encontró el propietario de Rasmiaw.');

  const payload = {
    workspace_id: WORKSPACE_ID,
    name: 'Rasmiaw Guía Global',
    is_active: true,
    assigned_only: false,
    role: 'general',
    scope: 'channels',
    product_scope: 'all',
    language: 'es',
    tone: 'friendly',
    priority: 100,
    reply_when_assigned: true,
    reply_outside_hours: true,
    requires_approval: false,
    response_mode: 'dynamic',
    max_response_chars: 650,
    persona:
      'Eres la guía global de Rasmiaw, rascadores en cartón para gatos. Atiendes 24/7 con calidez, claridad y español neutro. Ayudas a elegir productos desde el catálogo vigente y consultas pedidos antes de afirmarlos. En posventa, pagos manuales, reclamos o datos sensibles, resumes y escalas al equipo sin inventar ni prometer.',
    permissions: {
      crear_pedidos: false,
      crear_checkout: true,
      registrar_pago: false,
      editar_pedido: false,
      escalar_llamada: false,
      enviar_proactivo: false,
    },
    tools: {
      buscar_producto: 'auto',
      ver_producto: 'auto',
      lookup_order: 'auto',
      crear_checkout: 'auto',
      crear_pedido: 'off',
      registrar_pago: 'off',
      editar_pedido: 'off',
      cancelar_pedido: 'off',
      reembolsar: 'off',
      abrir_devolucion: 'off',
      crear_link_de_pago: 'off',
    },
    medios_pago: null,
    created_by: ownerId,
  };
  const { data: existing, error: lookupError } = await db
    .from('ai_agents')
    .select('id')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('name', payload.name)
    .maybeSingle();
  fail(lookupError);
  const { data: agent, error: agentError } = existing
    ? await db
        .from('ai_agents')
        .update(payload)
        .eq('id', existing.id)
        .select('id')
        .single()
    : await db.from('ai_agents').insert(payload).select('id').single();
  fail(agentError);

  const { error: clearChannels } = await db
    .from('ai_agent_channels')
    .delete()
    .eq('agent_id', agent.id);
  fail(clearChannels);
  const { error: channelError } = await db
    .from('ai_agent_channels')
    .insert(
      ['instagram', 'messenger', 'whatsapp'].map((channel) => ({
        agent_id: agent.id,
        channel,
      }))
    );
  fail(channelError);

  for (const rule of rules) {
    const { error } = await db.from('agent_guidance').upsert(
      {
        workspace_id: WORKSPACE_ID,
        agent_id: null,
        activa: true,
        origen: 'comercio',
        ...rule,
      },
      { onConflict: 'workspace_id,clave' }
    );
    fail(error);
  }

  const { error: commentError } = await db.from('ig_proactive_settings').upsert(
    {
      workspace_id: WORKSPACE_ID,
      paused: false,
      auto_reply_comments: true,
      outreach_enabled: false,
      comment_audience: 'all',
      comment_max_thread_replies: 3,
      comment_reply_mode: 'public_smart',
      comment_public_reply: true,
      comment_instagram: true,
      comment_facebook: true,
      comment_tiktok: false,
    },
    { onConflict: 'workspace_id' }
  );
  fail(commentError);

  const { data: recovery, error: recoveryError } = await db
    .from('ai_agents')
    .select('id, assigned_only')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('name', 'Rasmiaw Recuperación')
    .maybeSingle();
  fail(recoveryError);
  if (!recovery?.assigned_only)
    throw new Error('Rasmiaw Recuperación perdió su aislamiento.');

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('phone')
    .eq('user_id', ownerId)
    .maybeSingle();
  fail(profileError);
  if (!(profile?.phone ?? '').replace(/\D/g, '').match(/^\d{8,}$/)) {
    throw new Error(
      'Falta un teléfono del comercio para los avisos de escalación.'
    );
  }

  console.log(
    JSON.stringify({
      ok: true,
      agent: agent.id,
      recovery: recovery.id,
      rules: rules.length,
      comments: 'public_smart',
      escalationPhoneConfigured: true,
    })
  );
}

await main();
