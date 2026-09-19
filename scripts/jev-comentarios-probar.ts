/**
 * Prueba en vivo de las preguntas de Jev para comentarios: el puntaje de lead
 * (intención, sentimiento, spam), la decisión de abrir el privado y la
 * intención de un flujo. Casos escritos a mano en español rioplatense y
 * colombiano; imprime lo que Jev contesta con las MISMAS preguntas y umbrales
 * de producción. No escribe nada ni cobra a ningún comercio.
 *
 *   NODE_OPTIONS=--require ./scripts/stub-server-only.cjs \
 *     npx tsx --tsconfig tsconfig.json scripts/jev-comentarios-probar.ts
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

async function jev(state: unknown, questions: unknown) {
  const r = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as { answers: Record<string, never>; usage: { input_tokens: number } };
}

async function main() {
  const { preguntasDeLead, leadDesdeJev } = await import('@/lib/instagram-agent/lead-scoring');
  const { PREGUNTAS_DM, dmDesdeJev, heuristicDmDecision } = await import('@/lib/instagram-agent/dm-opportunity');
  const { preguntaDeIntencion, intencionDesdeJev } = await import('@/lib/flows/ai-intent');

  console.log('── Lead scoring (esperado → Jev)');
  const comentarios: Array<[string, string]> = [
    ['cuánto sale el serum? hacen envíos a Rosario?', 'high/neutral'],
    ['lo quierooo 😍😍', 'high/positive'],
    ['sirve para las manchas del sol?', 'medium/neutral'],
    ['@caro mirá esto', 'low/neutral'],
    ['😍', 'low/positive'],
    ['jajaja', 'low/neutral'],
    ['SIGUEME Y GANA SEGUIDORES GRATIS link en mi bio', 'spam'],
    ['dejen de mentir, publicidad falsa, son unos estafadores', 'spam/negative'],
    ['lo compré y no me hizo nada, una decepción', 'low/negative (no spam)'],
    ['tienen talle M en gris? lo llevo', 'high/positive'],
  ];
  // De a cinco, como en producción (`LOTE`).
  for (let desde = 0; desde < comentarios.length; desde += 5) {
    const lote = comentarios.slice(desde, desde + 5);
    const questions: Record<string, unknown> = {};
    lote.forEach((_, i) => {
      const q = preguntasDeLead(i);
      questions[`m${i}_intencion`] = q.intencion;
      questions[`m${i}_sentimiento`] = q.sentimiento;
      questions[`m${i}_spam`] = q.spam;
    });
    const t0 = Date.now();
    const r = await jev({ mensajes: lote.map(([c]) => c) }, questions);
    console.log(`   ${Date.now() - t0} ms · ${r.usage.input_tokens} tokens · $${((r.usage.input_tokens * 0.042) / 1e6).toFixed(5)} por ${lote.length} comentarios`);
    lote.forEach(([c, esperado], i) => {
      const a = r.answers as Record<string, { choice?: string; noul?: number; confidence?: number }>;
      const lead = leadDesdeJev({
        intencion: a[`m${i}_intencion`] as never,
        sentimiento: a[`m${i}_sentimiento`] as never,
        spam: a[`m${i}_spam`] as never,
      });
      console.log(`   ${lead.score.padEnd(6)} ${lead.sentiment.padEnd(8)} spam ${(a[`m${i}_spam`].noul ?? 0).toFixed(2)} ${lead.spam ? 'SPAM' : '    '} · "${c}"  [${esperado}]`);
    });
  }

  console.log('\n── Comentario → ¿abrir privado? (esperado → Jev)');
  const dms: Array<[string, string, string]> = [
    ['cuánto cuesta?', 'Te paso el precio por privado 😊', 'dm compra'],
    ['qué linda foto', 'Gracias! 💛', 'no'],
    ['mi pedido no llegó todavía', 'Te escribo por privado para ver tu pedido', 'dm pedido'],
    ['@juan mirá', 'Hola! Cualquier duda acá estamos', 'no'],
    ['me llegó roto', 'Lamentamos eso, te escribimos por privado', 'dm reclamo'],
    ['lo pueden usar embarazadas?', 'Sí, es apto en el embarazo. Usá el código MAMA10 en la web', 'dm privado'],
    ['hermosoooo', 'Gracias! Lo tenés en la web', 'no'],
  ];
  for (const [comentario, respuesta, esperado] of dms) {
    const piso = heuristicDmDecision(comentario, respuesta);
    const r = await jev({ comentario, respuesta_publica: respuesta }, PREGUNTAS_DM);
    const d = dmDesdeJev(r.answers as never);
    const a = r.answers as Record<string, { choice?: string; noul?: number }>;
    console.log(`   ${d.dm ? 'DM' : '  '} ${d.reason.padEnd(8)} abrir ${(a.abrir_privado.noul ?? 0).toFixed(2)} razón ${a.razon.choice}${piso.dm ? ' (heurística ya decía dm)' : ''} · "${comentario}"  [${esperado}]`);
  }

  console.log('\n── Intención en un flujo (esperado → Jev)');
  const intents = [
    { intent_key: 'confirmar', description: 'Confirma que quiere el pedido o que la dirección está bien' },
    { intent_key: 'cambiar_direccion', description: 'Quiere cambiar la dirección o los datos de entrega' },
    { intent_key: 'cancelar', description: 'No quiere el pedido, pide cancelarlo' },
    { intent_key: 'pregunta', description: 'Hace una pregunta sobre el producto o el envío' },
  ];
  const mensajes: Array<[string, string]> = [
    ['sí, todo bien, mándenlo', 'confirmar'],
    ['no lo quiero más, cancelen', 'cancelar'],
    ['ojo que me mudé, la dirección nueva es Mitre 450', 'cambiar_direccion'],
    ['cuánto tarda en llegar a Salta?', 'pregunta'],
    ['hola', 'none'],
    ['jaja ok', 'none/confirmar'],
  ];
  for (const [m, esperado] of mensajes) {
    const r = await jev({ mensaje_del_cliente: m }, { intencion: preguntaDeIntencion(intents) });
    const a = r.answers.intencion as { choice: string; confidence: number };
    const res = intencionDesdeJev(a as never, intents);
    console.log(`   ${String(res).padEnd(17)} (${a.choice} ${a.confidence.toFixed(2)}) · "${m}"  [${esperado}]`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
