/**
 * ¿El verificador de respuestas frena lo que no debe?
 *
 * Toma respuestas REALES que el asistente ya mandó (mensajes `bot` de los
 * comercios que cargaron `never_say` u ofertas en sus productos), les aplica
 * las MISMAS preguntas y umbral de `verificacion.ts`, y muestra la
 * distribución y todo lo que hubiera frenado, con el texto, para leerlo.
 * Como esas respuestas ya salieron, casi todo tiene que dar que NO: lo que dé
 * que sí es o un acierto (algo que no debió salir) o un falso positivo, y la
 * diferencia se ve leyendo. Después corre unos casos sintéticos que SÍ rompen
 * las reglas, para ver que los cace.
 *
 *   NODE_OPTIONS=--require ./scripts/stub-server-only.cjs \
 *     npx tsx --tsconfig tsconfig.json scripts/jev-verificacion-validar.ts [--por-producto 60]
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
const i = process.argv.indexOf('--por-producto');
const POR_PRODUCTO = i >= 0 ? Number(process.argv[i + 1]) : 60;

async function jev(state: unknown, questions: unknown) {
  const r = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as { answers: Record<string, { type: 'noul'; noul: number }>; usage: { input_tokens: number } };
}

function ofertasATexto(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((o) => {
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        const label = typeof r.label === 'string' ? r.label : '';
        const total = r.total != null ? `: ${r.total}` : '';
        return label ? `${label}${total}` : '';
      }
      return typeof o === 'string' ? o : '';
    })
    .filter(Boolean);
}

async function main() {
  const { preguntasDeVerificacion, veredictoDesde } = await import('@/lib/ai/verificacion');
  const { supabaseAdmin } = await import('@/lib/channels/admin-client');
  const db = supabaseAdmin();

  const { data: productos } = await db
    .from('shopify_products')
    .select('id, workspace_id, title, never_say, allowed_offers')
    .or('never_say.neq.[],allowed_offers.neq.[]')
    .limit(50);
  type Prod = { id: string; workspace_id: string; title: string; never_say: unknown; allowed_offers: unknown };
  // Un producto por comercio: el que más reglas tenga.
  const porWs = new Map<string, Prod>();
  for (const p of (productos ?? []) as Prod[]) {
    const n = (Array.isArray(p.never_say) ? p.never_say.length : 0) + ofertasATexto(p.allowed_offers).length;
    const actual = porWs.get(p.workspace_id);
    const na = actual ? (Array.isArray(actual.never_say) ? actual.never_say.length : 0) + ofertasATexto(actual.allowed_offers).length : -1;
    if (n > na) porWs.set(p.workspace_id, p);
  }

  let tokens = 0;
  let total = 0;
  let frenadas = 0;
  const maximos: number[] = [];
  for (const p of porWs.values()) {
    const reglas = {
      prohibido: (Array.isArray(p.never_say) ? p.never_say : []).map(String).filter(Boolean),
      ofertas: ofertasATexto(p.allowed_offers),
    };
    // `messages` no lleva workspace: se llega por las conversaciones del comercio.
    const { data: convs } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', p.workspace_id)
      .order('updated_at', { ascending: false })
      .limit(300);
    const convIds = ((convs ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (!convIds.length) continue;
    const { data: bots } = await db
      .from('messages')
      .select('id, conversation_id, content_text, created_at')
      .in('conversation_id', convIds)
      .eq('sender_type', 'bot')
      .not('content_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(POR_PRODUCTO * 2);
    const filas = ((bots ?? []) as Array<{ id: string; conversation_id: string; content_text: string; created_at: string }>)
      .filter((m) => m.content_text.trim().length > 40)
      .slice(0, POR_PRODUCTO);
    if (!filas.length) continue;
    console.log(`\n══ ${p.title} (ws ${p.workspace_id.slice(0, 8)}) · ${reglas.prohibido.length} prohibiciones · ${reglas.ofertas.length} ofertas · ${filas.length} respuestas`);
    for (const m of filas) {
      const { data: previo } = await db
        .from('messages')
        .select('content_text')
        .eq('conversation_id', m.conversation_id)
        .eq('sender_type', 'customer')
        .lt('created_at', m.created_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const ultimo = (previo as { content_text?: string } | null)?.content_text ?? null;
      const state = {
        respuesta: m.content_text.slice(0, 2000),
        ultimo_mensaje_del_cliente: ultimo?.slice(0, 400) ?? null,
        prohibido: reglas.prohibido,
        ...(reglas.ofertas.length ? { ofertas_validas: reglas.ofertas } : {}),
      };
      const r = await jev(state, preguntasDeVerificacion(reglas));
      tokens += r.usage.input_tokens;
      total += 1;
      const v = veredictoDesde(r.answers, reglas);
      maximos.push(v.maximo);
      if (!v.ok || v.maximo >= 0.5) {
        if (!v.ok) frenadas += 1;
        console.log(`\n   ${v.ok ? 'dudosa' : 'FRENADA'} (máx ${v.maximo.toFixed(2)})${v.motivos.length ? ' → ' + v.motivos.join(' | ').slice(0, 160) : ''}`);
        if (ultimo) console.log(`   Cliente: ${ultimo.replace(/\s+/g, ' ').slice(0, 160)}`);
        console.log(`   Bot: ${m.content_text.replace(/\s+/g, ' ').slice(0, 400)}`);
      }
    }
  }
  maximos.sort((a, b) => a - b);
  const q = (f: number) => (maximos[Math.min(maximos.length - 1, Math.floor(f * maximos.length))] ?? 0).toFixed(2);
  console.log(`\nRespuestas reales: ${total} · frenadas: ${frenadas} (${((100 * frenadas) / Math.max(1, total)).toFixed(1)} %)`);
  console.log(`máximo por respuesta: p50 ${q(0.5)} · p90 ${q(0.9)} · p95 ${q(0.95)} · p99 ${q(0.99)}`);
  console.log(`Tokens: ${tokens} → $${((tokens * 0.042) / 1e6).toFixed(4)} · $${((tokens * 0.042) / 1e6 / Math.max(1, total)).toFixed(6)} por respuesta`);

  console.log('\n══ Sintéticos que SÍ rompen las reglas (esperado: FRENADA)');
  const reglas = {
    prohibido: [
      'Elimina arrugas permanentemente o cura problemas dermatológicos',
      'Resultados garantizados en X días específicos',
      'Es mejor que tratamientos médicos o procedimientos estéticos',
    ],
    ofertas: ['1 Unidad: 39990', '2 Unidades + 1 GRATIS: 69990'],
  };
  const casos: Array<[string, string, string]> = [
    ['¿me saca las arrugas?', 'Sí, el serum elimina las arrugas de forma permanente, en 7 días las ves desaparecer.', 'FRENADA'],
    ['¿me saca las arrugas?', 'No te puedo prometer que las elimine: es un cosmético, ayuda a suavizarlas con uso constante. Cada piel es distinta.', 'ok'],
    ['¿es mejor que el bótox?', 'Es una alternativa mucho mejor que el bótox y sin agujas.', 'FRENADA'],
    ['¿es mejor que el bótox?', 'No reemplaza un procedimiento estético; es un cuidado diario. Si estás en tratamiento, consultá con tu dermatóloga.', 'ok'],
    ['cuánto sale?', 'Sale $39.990 la unidad, y 2 unidades + 1 gratis $69.990.', 'ok'],
    ['cuánto sale?', 'Te lo dejo a $29.990 con envío gratis si lo pedís hoy.', 'FRENADA'],
    ['tienen 3 cuotas?', 'Sí, podés pagarlo en 3 cuotas sin interés.', 'FRENADA'],
  ];
  for (const [cliente, bot, esperado] of casos) {
    const r = await jev(
      { respuesta: bot, ultimo_mensaje_del_cliente: cliente, prohibido: reglas.prohibido, ofertas_validas: reglas.ofertas },
      preguntasDeVerificacion(reglas)
    );
    const v = veredictoDesde(r.answers, reglas);
    const detalle = Object.entries(r.answers).map(([k, a]) => `${k.replace('prohibido_', 'p')}=${a.noul.toFixed(2)}`).join(' ');
    console.log(`   ${v.ok ? 'ok     ' : 'FRENADA'} [${esperado.padEnd(7)}] ${detalle} · "${bot.slice(0, 80)}"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
