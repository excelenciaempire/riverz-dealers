/**
 * ¿Jev escala lo mismo que Haiku escalaba?
 *
 * Toma de `ai_replies` las veces que el clasificador de Haiku dijo que sí
 * (`skip_reason = 'problema_detectado'`) y una muestra de las veces que dijo
 * que no (respuestas enviadas en conversaciones ya cargadas), rearma el estado
 * que vio —los últimos seis turnos y el mensaje— y se lo pregunta a Jev con
 * las MISMAS preguntas y umbrales de producción (`escalada.ts`).
 *
 * Imprime acuerdo, desacuerdos con el texto, y cuánto costó. No escribe nada.
 *
 *   NODE_OPTIONS=--require ./scripts/stub-server-only.cjs \
 *     npx tsx --tsconfig tsconfig.json scripts/jev-escalada-validar.ts [--dias 60] [--negativos 60]
 */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
if (!process.env.TYPESAFE_API_KEY) {
  for (const line of readFileSync(`${process.env.USERPROFILE ?? process.env.HOME}/.claude/secrets.env`, 'utf8').split(/\r?\n/)) {
    const m = /^TYPESAFE_API_KEY=(.*)$/.exec(line);
    if (m) process.env.TYPESAFE_API_KEY = m[1].trim();
  }
}

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const DIAS = arg('--dias', 60);
const NEGATIVOS = arg('--negativos', 60);

interface Caso {
  etiqueta: 'escalo' | 'no_escalo';
  conversationId: string;
  mensaje: string;
  hilo: string[];
  hayPedido: boolean;
  porQueHaiku: string | null;
}

async function main() {
  const { PREGUNTAS_ESCALADA, escaladaDesdeJev, señalDura, pagoAsistido, esAdjunto } = await import('@/lib/ai/escalada');
  const { supabaseAdmin } = await import('@/lib/channels/admin-client');
  const db = supabaseAdmin();
  const desde = new Date(Date.now() - DIAS * 86400e3).toISOString();

  const { data: positivas } = await db
    .from('ai_replies')
    .select('conversation_id, message_id, created_at')
    .eq('status', 'skipped')
    .eq('skip_reason', 'problema_detectado')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(200);
  const { data: negativas } = await db
    .from('ai_replies')
    .select('conversation_id, message_id, created_at')
    .eq('status', 'sent')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(NEGATIVOS * 3);

  const casos: Caso[] = [];
  for (const [etiqueta, filas] of [
    ['escalo', positivas ?? []],
    ['no_escalo', negativas ?? []],
  ] as const) {
    let tomados = 0;
    for (const f of filas as Array<{ conversation_id: string; message_id: string | null; created_at: string }>) {
      if (etiqueta === 'no_escalo' && tomados >= NEGATIVOS) break;
      if (!f.message_id) continue;
      let { data: msg } = await db
        .from('messages')
        .select('content_text, created_at, sender_type')
        .eq('id', f.message_id)
        .maybeSingle();
      // En una respuesta enviada el id apunta a LA RESPUESTA: el mensaje que
      // vio el clasificador es el último de la clienta antes de esa.
      if ((msg as { sender_type?: string } | null)?.sender_type !== 'customer') {
        const { data: entrante } = await db
          .from('messages')
          .select('content_text, created_at, sender_type')
          .eq('conversation_id', f.conversation_id)
          .eq('sender_type', 'customer')
          .lt('created_at', (msg as { created_at: string } | null)?.created_at ?? f.created_at)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        msg = entrante;
      }
      const texto = (msg as { content_text?: string | null } | null)?.content_text?.trim();
      if (!texto || texto.length < 4) continue;
      // La capa 1 (regex) corre antes y no paga modelo: lo que atrapa no es
      // trabajo de Jev y no se cuenta.
      if (señalDura(texto) || pagoAsistido({ mensaje: texto })) continue;
      const { data: previos } = await db
        .from('messages')
        .select('sender_type, content_text')
        .eq('conversation_id', f.conversation_id)
        .lt('created_at', (msg as { created_at: string }).created_at)
        .not('content_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(6);
      const hilo = ((previos ?? []) as Array<{ sender_type: string; content_text: string }>)
        .reverse()
        .map((m) => `${m.sender_type === 'customer' ? 'Cliente' : 'Nosotros'}: ${m.content_text}`)
        .filter((l) => l.trim().length > 12);
      const { data: conv } = await db
        .from('conversations')
        .select('subject, needs_human_summary')
        .eq('id', f.conversation_id)
        .maybeSingle();
      const c = conv as { subject?: string | null; needs_human_summary?: string | null } | null;
      // Los negativos sólo cuentan si el clasificador CORRIÓ: pedido o ≥3 turnos.
      if (etiqueta === 'no_escalo' && !c?.subject && hilo.length < 3) continue;
      casos.push({
        etiqueta,
        conversationId: f.conversation_id,
        mensaje: texto,
        hilo,
        hayPedido: Boolean(c?.subject),
        porQueHaiku: c?.needs_human_summary ?? null,
      });
      tomados += 1;
    }
  }
  console.log(`Casos: ${casos.filter((c) => c.etiqueta === 'escalo').length} que Haiku escaló, ${casos.filter((c) => c.etiqueta === 'no_escalo').length} que no.\n`);

  let tokens = 0;
  let ms = 0;
  const resultados: Array<Caso & { jev: ReturnType<typeof escaladaDesdeJev>; p: Record<string, number> }> = [];
  for (const c of casos) {
    const t0 = Date.now();
    const r = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state: { conversacion: c.hilo.slice(-6), ultimo_mensaje: c.mensaje.slice(0, 600), ultimo_mensaje_es_adjunto: esAdjunto(c.mensaje), hay_pedido: c.hayPedido },
        questions: PREGUNTAS_ESCALADA,
      }),
    });
    ms += Date.now() - t0;
    if (!r.ok) {
      console.error('Jev', r.status, await r.text());
      continue;
    }
    const j = (await r.json()) as { answers: Parameters<typeof escaladaDesdeJev>[0]; usage: { input_tokens: number } };
    tokens += j.usage.input_tokens;
    resultados.push({
      ...c,
      jev: escaladaDesdeJev(j.answers),
      p: {
        problema: j.answers.problema_en_curso.noul,
        destino: j.answers.destino_distinto.noul,
        fuera: j.answers.pide_fuera_de_alcance.noul,
        pago: j.answers.pago_por_confirmar.noul,
        noenc: j.answers.pedido_no_encontrado.noul,
      },
    });
  }

  const acuerdo = (e: Caso['etiqueta']) => {
    const del = resultados.filter((r) => r.etiqueta === e);
    const ok = del.filter((r) => (e === 'escalo') === Boolean(r.jev)).length;
    return `${ok}/${del.length}`;
  };
  console.log(`Acuerdo con Haiku · escaló: ${acuerdo('escalo')} · no escaló: ${acuerdo('no_escalo')}`);
  console.log(`Tokens: ${tokens} → $${((tokens * 0.042) / 1e6).toFixed(5)} · ${Math.round(ms / Math.max(1, resultados.length))} ms por caso\n`);

  const p = (n: number) => n.toFixed(2);
  const dist = (e: Caso['etiqueta'], k: keyof (typeof resultados)[number]['p']) => {
    const v = resultados.filter((r) => r.etiqueta === e).map((r) => r.p[k]).sort((a, b) => a - b);
    const q = (f: number) => p(v[Math.min(v.length - 1, Math.floor(f * v.length))] ?? 0);
    return `p50 ${q(0.5)} · p75 ${q(0.75)} · p90 ${q(0.9)} · p95 ${q(0.95)} · max ${p(v[v.length - 1] ?? 0)}`;
  };
  for (const k of ['problema', 'destino', 'fuera', 'pago', 'noenc'] as const) {
    console.log(`${k.padEnd(9)} no_escaló: ${dist('no_escalo', k)}`);
    console.log(`${''.padEnd(9)} escaló:    ${dist('escalo', k)}`);
  }
  console.log('');
  for (const r of resultados) {
    const desacuerdo = (r.etiqueta === 'escalo') !== Boolean(r.jev);
    if (!desacuerdo) continue;
    console.log(`── ${r.etiqueta === 'escalo' ? 'HAIKU ESCALÓ, JEV NO' : 'JEV ESCALA, HAIKU NO'} · conv ${r.conversationId.slice(0, 8)}`);
    console.log(`   problema ${p(r.p.problema)} · destino ${p(r.p.destino)} · fuera ${p(r.p.fuera)} · pago ${p(r.p.pago)} · noenc ${p(r.p.noenc)}${r.jev ? ` → ${r.jev.clase}/${r.jev.urgencia}` : ''}`);
    if (r.porQueHaiku) console.log(`   Haiku: ${r.porQueHaiku.replace(/\s+/g, ' ').slice(0, 160)}`);
    for (const l of r.hilo.slice(-3)) console.log(`   ${l.replace(/\s+/g, ' ').slice(0, 140)}`);
    console.log(`   >> ${r.mensaje.replace(/\s+/g, ' ').slice(0, 200)}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
