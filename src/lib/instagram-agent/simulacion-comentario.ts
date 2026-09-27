import type { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { prometeAveriguar } from '@/lib/ai/salida';
import { simularRespuesta, type TurnoSimulado } from '@/lib/ai/simulacion';
import type { AiAgent } from '@/lib/ai/types';
import { addCommentContextToPrivateReply } from '@/lib/comments/private-reply-context';
import {
  asksForCurrentOffer,
  asksForPrice,
  replyForUnidentifiedPrice,
  unauthorizedQuotedPrices,
} from '@/lib/products/price-integrity';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import { commentAgentCanReply, resolveIgAgent } from './agent-link';
import { loadBrandContext } from './brand-context';
import { autoReplyCommentsEnabled, loadCommentSettings } from './controls';
import { decideCommentDm } from './dm-opportunity';
import { shouldHideComment, keepObjectionPublic } from './comment-moderation-policy';
import { scoreLeads, type LeadScore } from './lead-scoring';
import {
  afirmaLoQueNoSabe,
  esCriticaPublica,
  instruccionPara,
  mereceRespuesta,
} from './merece-respuesta';
import { loadProductBrain } from './product-brain';
import { esPagoManualEnComentario, publicReplyFrom } from './respuesta-publica';
import { loadStoreLinks } from './store-links';

/**
 * ¿Qué pasaría en vivo con este comentario? Sin publicar ni mandar nada.
 *
 * Recorre las mismas puertas que `replyToComment` (instagram-agent/realtime)
 * y en el mismo orden: el interruptor de Comentarios, la red, el texto, la
 * crítica y el spam (que en vivo se OCULTAN), la intención, el pedido de una
 * persona, el precio sin verificar, lo que no se puede publicar, y al final el
 * modo del comercio para decidir qué va en el comentario y qué por privado.
 *
 * Lo único que no puede reproducir es lo que depende de una persona real que
 * todavía no existe: su pedido en la tienda y el hilo anterior bajo el post.
 * El pedido se simula con el teléfono de prueba que manda la pantalla; el
 * hilo, con lo que ya se dijo en esta prueba.
 */

export type CanalComentario = 'ig_comment' | 'fb_comment';

export interface ComentarioSimulado {
  /** Por qué en vivo no saldría nada. null = se contesta. */
  barrera: { tipo: string; detalle: string | null } | null;
  /** Lo que se publicaría debajo del comentario. */
  publico: string | null;
  /** Lo que llegaría por privado. */
  privado: string | null;
  /** En vivo el comentario se oculta (crítica o spam) y no se contesta. */
  oculto: 'critica' | 'spam' | null;
  /** Además de contestar, el hilo queda marcado para una persona. */
  escala: string | null;
  /** Quedaría como propuesta, esperando el clic de alguien. */
  esperaAprobacion: boolean;
  agente: { id: string; nombre: string } | null;
  herramientas: unknown;
}

function vacio(
  parcial: Partial<ComentarioSimulado>
): ComentarioSimulado {
  return {
    barrera: null,
    publico: null,
    privado: null,
    oculto: null,
    escala: null,
    esperaAprobacion: false,
    agente: null,
    herramientas: [],
    ...parcial,
  };
}

const barrera = (tipo: string, detalle: string | null = null) =>
  vacio({ barrera: { tipo, detalle } });

export async function simularComentario(
  db: ReturnType<typeof supabaseAdmin>,
  input: {
    workspaceId: string;
    canal: CanalComentario;
    texto: string;
    historial: TurnoSimulado[];
    simulatedPhone?: string | null;
  }
): Promise<ComentarioSimulado> {
  const { workspaceId, canal } = input;
  const texto = input.texto.trim();

  if (!(await autoReplyCommentsEnabled(db, workspaceId))) {
    return barrera('comment_apagado');
  }
  const cfg = await loadCommentSettings(db, workspaceId);
  const redActiva = canal === 'fb_comment' ? cfg.facebook : cfg.instagram;
  if (!redActiva) return barrera('comment_red_apagada');
  if (texto.length < 3) return barrera('comment_sin_texto');

  const resuelta = await resolveAnthropicKey(db, { workspaceId });
  const apiKey = resuelta?.key ?? null;
  if (!apiKey) return barrera('comment_sin_llave');
  const billing = { db, workspaceId, concepto: 'ia_clasificacion' as const };

  // La crítica y el spam se ocultan y no se contestan: decisión del dueño,
  // igual que en vivo. Primero la regla sin modelo, después el clasificador.
  const motivo = mereceRespuesta(texto);
  const priceQuestion = asksForPrice(texto);
  const critica = esCriticaPublica(texto);
  if (shouldHideComment(workspaceId, false, critica)) return vacio({ oculto: 'critica' });
  let score: LeadScore = 'medium';
  // El clasificador sólo corre si la cuenta puede gastar: es la misma puerta
  // que en vivo. En una instalación que todavía no pagó se prueba igual y la
  // clasificación queda en "media", que es lo que el camino asume sin ella.
  if (await puedeUsarIa(db, workspaceId)) {
    try {
      const [s] = await scoreLeads(apiKey, [texto], billing, null);
      if (s?.spam && shouldHideComment(workspaceId, true, critica)) return vacio({ oculto: 'spam' });
      if (s?.score) score = s.score;
    } catch {
      /* sin clasificar: se sigue como en vivo con el nivel medio */
    }
  }
  if (cfg.audience === 'intent' && score === 'low' && !priceQuestion && !motivo) {
    return barrera('comment_sin_intencion');
  }

  const ig = await resolveIgAgent(db, workspaceId, null);
  if (!ig.id) return barrera('sin_agente');
  if (!commentAgentCanReply(ig, texto)) return barrera('comment_pide_humano');

  // El tope por hilo: en vivo, más de N respuestas nuestras bajo el mismo post
  // ya no es un comentario sino una conversación.
  const nuestras = input.historial.filter((t) => t.role === 'assistant').length;
  if (cfg.maxThreadReplies > 0 && nuestras >= cfg.maxThreadReplies) {
    return barrera('comment_tope_del_hilo', String(cfg.maxThreadReplies));
  }

  const { data: fila } = await db
    .from('ai_agents')
    .select('*')
    .eq('id', ig.id)
    .is('deleted_at', null)
    .maybeSingle();
  const agent = fila as AiAgent | null;
  if (!agent) return barrera('sin_agente');
  const quien = { id: agent.id, nombre: agent.name };

  const [brand, links, product] = await Promise.all([
    loadBrandContext(db, workspaceId, agent.id),
    loadStoreLinks(db, workspaceId, []),
    loadProductBrain(db, workspaceId, {
      text: texto,
      verifyPricing: asksForCurrentOffer(texto),
    }),
  ]);
  const precioSinVerificar = priceQuestion && (!product || !product.pricingVerified);

  let texto_ = '';
  let herramientas: unknown = [];
  if (precioSinVerificar) {
    texto_ = replyForUnidentifiedPrice(
      brand?.language,
      links.products.map((p) => p.url)
    );
  } else {
    const r = await simularRespuesta(db, agent, {
      message: texto,
      historial: input.historial,
      simulatedPhone: input.simulatedPhone ?? null,
      simulatedChannel: canal,
      superficie: 'comentario',
      extraBrief:
        [motivo ? instruccionPara(motivo) : null, product?.brief]
          .filter(Boolean)
          .join('\n\n') || null,
    });
    texto_ = r.reply;
    herramientas = r.herramientas;
  }
  if (!texto_.trim()) return { ...barrera('comment_respuesta_vacia'), agente: quien };

  const invalidos = unauthorizedQuotedPrices(
    texto_,
    product?.authorizedPriceValues ?? [],
    { priceQuestion }
  );
  if (invalidos.length > 0) {
    return {
      ...barrera('comment_precio_no_autorizado', invalidos.join(', ')),
      agente: quien,
    };
  }
  if (afirmaLoQueNoSabe(texto_)) {
    return { ...barrera('comment_afirma_lo_que_no_sabe', texto_.slice(0, 160)), agente: quien };
  }
  if (prometeAveriguar(texto_)) {
    return { ...barrera('comment_prometia_averiguar', texto_.slice(0, 160)), agente: quien };
  }

  const decision = await decideCommentDm({
    billing,
    mode: cfg.replyMode,
    apiKey,
    comment: texto,
    reply: texto_,
    hasOrderQuestion: false,
  });
  const esPagoManual = esPagoManualEnComentario(texto);
  if (keepObjectionPublic(workspaceId, critica, decision.reason === 'pedido' || esPagoManual)) {
    decision.dm = false;
    decision.reason = 'ninguna';
  }
  const paraElPublico = esPagoManual
    ? { ...decision, reason: 'privado' as const }
    : decision;
  const privado = decision.dm
    ? addCommentContextToPrivateReply({
        reply: texto_,
        comment: texto,
        language: brand?.language,
      })
    : null;
  const publico = cfg.publicReply
    ? publicReplyFrom(texto_, decision.dm, paraElPublico) || null
    : null;
  const escala =
    decision.reason === 'pedido' || decision.reason === 'reclamo' || esPagoManual
      ? decision.reason === 'reclamo'
        ? 'reclamo'
        : decision.reason === 'pedido'
          ? 'pedido'
          : 'pago'
      : null;

  return vacio({
    publico,
    privado,
    escala,
    esperaAprobacion: agent.requires_approval === true,
    agente: quien,
    herramientas,
  });
}
