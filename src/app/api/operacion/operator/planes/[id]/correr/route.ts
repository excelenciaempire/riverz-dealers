import {
  getFeatureFlags,
  isOperatorFleet,
  isRiverz2,
} from '@/lib/admin/feature-flags';
import { getAnthropicStreaming } from '@/lib/ai/anthropic-client';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import type { CapabilityContext } from '@/lib/capabilities/types';
import { csrfGuard } from '@/lib/csrf';
import type { Locale } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { grabador } from '@/lib/operator/bloques';
import { encodeEvent, type OperatorEvent } from '@/lib/operator/events';
import { crearPresupuesto } from '@/lib/operator/fleet/budget';
import { ejecutarPlan } from '@/lib/operator/fleet/ejecutar-plan';
import {
  cargarPlan,
  marcarPlan,
  reclamarPlan,
  type PlanGuardado,
} from '@/lib/operator/fleet/plan';
import { anthropicRunner } from '@/lib/operator/fleet/runner';
import { guardarGasto } from '@/lib/operator/gasto';
import { appendMessage } from '@/lib/operator/threads';
import { limitByKey } from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { NextResponse } from 'next/server';

/**
 * Correr un plan que una persona aprobó.
 *
 * Es una ruta propia y no un turno de chat con la palabra "aprobado". La
 * alternativa se descartó por un motivo concreto: gastaría una llamada al
 * modelo para volver a decidir lo mismo, y le daría la oportunidad de repartir
 * distinto de lo que la persona aprobó, que es justo lo que la aprobación viene
 * a impedir. Lo que corre son los pasos GUARDADOS, textuales, igual que aprobar
 * una acción ejecuta los argumentos guardados y no lo que el modelo diga
 * después.
 *
 * Devuelve el mismo NDJSON que el chat, así que la pantalla lo lee con el mismo
 * código.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Más bajo que el del chat a propósito.
 *
 * Un plan mueve al equipo entero: cinco por minuto ya es más de lo que una
 * persona puede mirar, y el techo protege el saldo de la plataforma de un bucle
 * de reintentos.
 */
const RATE = { limit: 5, windowMs: 60_000 };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId)
    return NextResponse.json({ error: 'no_workspace' }, { status: 400 });

  const flags = await getFeatureFlags(admin, workspaceId);
  if (!isRiverz2(flags) || !isOperatorFleet(flags)) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 });
  }

  const rl = await limitByKey(`operator:plan:${workspaceId}`, RATE);
  if (!rl.success)
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const { id: planId } = await params;
  const plan = await cargarPlan(admin, planId, workspaceId);
  if (!plan) return NextResponse.json({ error: 'no existe' }, { status: 404 });

  // El UPDATE condicionado es lo que impide correrlo dos veces: dos clicks
  // seguidos, o dos pestañas abiertas, y el segundo se encuentra con que ya no
  // está esperando aprobación.
  const reclamado = await reclamarPlan(admin, planId, workspaceId, user.id);
  if (!reclamado) {
    return NextResponse.json(
      { error: 'ya no esta esperando' },
      { status: 409 }
    );
  }

  const resolved = await resolveAnthropicKey(admin, { workspaceId });
  if (!resolved)
    return NextResponse.json({ error: 'sin clave de IA' }, { status: 400 });

  const locale = await getLocale();
  const ctx: CapabilityContext = {
    db: admin,
    workspaceId,
    actor: { type: 'operator', id: user.id },
    locale,
  };
  const threadId = plan.threadId ?? planId;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      let cerrado = false;
      // Igual que en el turno normal: el trabajo del equipo se graba de paso
      // para que, al volver a abrir la conversación, cada cosa que se construyó
      // siga estando donde ocurrió.
      const turnoVisto = grabador();
      const push = (e: OperatorEvent) => {
        turnoVisto.ver(e);
        if (cerrado) return;
        try {
          controller.enqueue(enc.encode(encodeEvent(e)));
        } catch {
          cerrado = true;
        }
      };

      // Un plan de varias olas puede tardar minutos sin decir nada, y un NDJSON
      // mudo es indistinguible de una conexión cortada para el navegador, para
      // un proxy y para la persona que está mirando.
      const latido = setInterval(() => push({ t: 'latido' }), 10_000);

      const presupuesto = crearPresupuesto();
      let cierre: string | null = null;

      /**
       * Lo primero que se lee al aprobar: qué empieza ahora.
       *
       * La conversación se quedaba muda. La tarjeta pasaba a «corriendo» y el
       * primer especialista podía tardar minutos en devolver algo, así que
       * entre el click y la primera señal había un hueco en el que no se sabía
       * si había pasado algo. Aprobar es una acción de la persona: la respuesta
       * es decir por dónde se empieza.
       *
       * Sale antes de cargar nada, así que llega con el primer byte.
       */
      const apertura = comoArranca(plan, locale);

      try {
        push({ t: 'plan_estado', planId, estado: 'corriendo' });
        if (apertura) push({ t: 'text', delta: apertura });
        const r = await ejecutarPlan({
          plan,
          ctx,
          threadId,
          // Diez minutos: un plan de varias olas los usa sin que nada falle.
          runner: anthropicRunner(
            getAnthropicStreaming(resolved.key, {
              db: ctx.db,
              workspaceId: ctx.workspaceId,
              concepto: 'ia_operador',
              origenDeLaClave: resolved.source,
            })
          ),
          emit: push,
          presupuesto,
        });

        // El cierre en el hilo: qué quedó hecho y qué quedó esperando. Sin
        // esto, la conversación termina con el plan propuesto y nunca cuenta
        // cómo salió.
        cierre = resumirCierre(r);
        push({ t: 'text', delta: cierre });

        /**
         * Y deja de estar propuesto.
         *
         * Nadie lo marcaba: el plan corría entero y su fila se quedaba en
         * `propuesto` para siempre. Mientras la tarjeta vivía sólo en la
         * memoria de la pestaña eso no se notaba; desde que el plan se lee del
         * hilo al abrirlo, un plan ya aprobado y ya ejecutado volvía a aparecer
         * pidiendo aprobación cada vez que entrabas.
         */
        const fallidos = r.pasos.filter(
          (paso) => paso.estado === 'fallido'
        ).length;
        await marcarPlan(
          admin,
          planId,
          workspaceId,
          fallidos === 0
            ? 'terminado'
            : fallidos === r.pasos.length
              ? 'fallido'
              : 'parcial'
        );
      } catch (err) {
        push({
          t: 'error',
          message: err instanceof Error ? err.message : 'failed',
        });
        // Un plan que se cayó tampoco sigue esperando aprobación.
        await marcarPlan(admin, planId, workspaceId, 'fallido').catch(
          () => undefined
        );
      } finally {
        clearInterval(latido);

        // La contabilidad va acá y no en el camino feliz: un plan que se cae a
        // la mitad ya quemó los tokens de todas las ramas que corrieron en
        // paralelo. Anotándolo sólo al terminar bien, el tope diario —que sale
        // de sumar `operator_messages`— no veía nada de eso y el día siguiente
        // arrancaba creyendo que no se gastó.
        const total = presupuesto.total();
        const huboGasto = total.promptTokens > 0 || total.completionTokens > 0;
        // Si se cayó antes de llamar al modelo no hay nada que contabilizar, y
        // dejar el mensaje igual sería ensuciar el hilo con un turno vacío.
        if (cierre !== null || huboGasto) {
          await guardarGasto(admin, {
            workspaceId,
            threadId,
            porAgente: presupuesto.porAgente(),
          });
          await appendMessage(admin, {
            threadId,
            workspaceId,
            role: 'assistant',
            text:
              cierre === null
                ? translate(locale, 'operation.operatorError')
                : [apertura, cierre].filter(Boolean).join('\n\n'),
            bloques: turnoVisto.bloques,
            promptTokens: total.promptTokens,
            completionTokens: total.completionTokens,
          }).catch(() => {
            /* si el plan no cuelga de un hilo de chat, no hay dónde anotarlo */
          });
        }

        if (cierre !== null) push({ t: 'done', thread: threadId });
        cerrado = true;
        try {
          controller.close();
        } catch {
          /* ya estaba cerrado */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'Content-Encoding': 'identity',
      'X-Accel-Buffering': 'no',
    },
  });
}

/**
 * Por dónde se empieza, dicho al aprobar.
 *
 * Lo escribe el servidor porque es un hecho —el paso 1 del plan que se acaba de
 * aprobar— y no algo que haya que redactar: gastar una llamada al modelo en
 * anunciar lo que ya está escrito en la tarjeta sería pagar por repetir.
 */
function comoArranca(plan: PlanGuardado, locale: Locale): string {
  const primero = plan.pasos.find((p) => p.i === 0) ?? plan.pasos[0];
  if (!primero) return '';
  const que = (primero.que || primero.encargo).trim();
  if (!que) return '';
  return translate(
    locale,
    plan.pasos.length === 1
      ? 'operation.planArrancoUno'
      : 'operation.planArranco',
    { que: enMinuscula(que) }
  );
}

/** «Escribir la plantilla» detrás de dos puntos no lleva mayúscula. */
function enMinuscula(s: string): string {
  return s.charAt(0).toLocaleLowerCase('es') + s.slice(1);
}

/**
 * Cómo salió, en una línea.
 *
 * Lo escribe el servidor y no el modelo: es un recuento de hechos, y gastar una
 * llamada en redactarlo sería pagar por adornar una suma. Con negritas en las
 * cifras, que es como se escribe en esta casa.
 */
function resumirCierre(r: Awaited<ReturnType<typeof ejecutarPlan>>): string {
  const ok = r.pasos.filter((p) => p.estado === 'ok').length;
  const fallidos = r.pasos.filter((p) => p.estado === 'fallido');
  const saltados = r.pasos.filter((p) => p.estado === 'saltado').length;

  const partes: string[] = [];
  // Ni los pasos, ni lo creado, ni lo que espera: de eso ya habla la tarjeta de
  // decisión que aparece justo abajo, y el banco muestra lo que quedó armado.
  // Repetirlo en una línea de cifras era decir dos veces lo mismo, y la segunda
  // en un idioma —«2 pasos listos»— que no es el de nadie.
  //
  // Queda sólo lo que no tiene otro lugar donde verse.
  // «Listos» sólo si algo quedó hecho. Un plan donde los dos pasos terminaron
  // sin construir nada se cerraba con «2 pasos listos» sobre una pantalla en la
  // que no había pasado nada: el recuento contaba turnos del modelo, no
  // trabajo. Lo que sí pasó lo cuenta cada paso con su resumen.
  if (r.propuestas === 0 && r.construidas > 0 && ok > 0) {
    partes.push(`**${ok}** ${ok === 1 ? 'paso listo' : 'pasos listos'}`);
  }
  if (fallidos.length > 0) {
    partes.push(
      `**${fallidos.length}** ${fallidos.length === 1 ? 'falló' : 'fallaron'}`
    );
  }
  if (saltados > 0) {
    partes.push(
      `**${saltados}** no se ${saltados === 1 ? 'intentó' : 'intentaron'}`
    );
  }

  // Sin nada que agregar, no se agrega nada: una línea de relleno abajo de una
  // decisión sólo la corre hacia arriba.
  const linea = partes.length > 0 ? partes.join(' · ') : '';
  if (fallidos.length === 0) return linea;
  return `${linea}\n\n${fallidos.map((f) => `${f.agente}: ${f.resumen}`).join('\n')}`;
}
