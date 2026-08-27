import { NextResponse } from 'next/server';
import { pingCron } from '@/lib/cron/heartbeat';
import { assertVoiceWorkerAuth } from '@/lib/voice/auth';
import { VOICE_WORKER_JOB } from '@/lib/voice/labels';

/**
 * Latido del worker de voz.
 *
 * El worker es un proceso de fondo sin puerto: nadie lo puede sondear desde
 * afuera, y `dispatchVoiceCall` tiene ÉXITO con cero workers conectados —
 * LiveKit simplemente encola el trabajo. Por eso el cron despachaba feliz
 * mientras el teléfono no sonaba, y la pantalla de Llamadas decía «listo».
 *
 * El worker avisa que sigue vivo cada minuto. Escribe en `cron_runs` con el
 * mismo helper que los trabajos periódicos, así que además de destrabar
 * `voiceReadiness` aparece solo en el panel de infraestructura, con su fila y
 * su umbral de atraso, sin código nuevo del otro lado.
 */
export async function POST(request: Request) {
  try {
    assertVoiceWorkerAuth(request);
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  await pingCron(VOICE_WORKER_JOB);
  return NextResponse.json({ ok: true });
}
