import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { mejorarFeedbackReal, mejorarSesionDePrueba } from '@/lib/ai/mejoras-de-pruebas';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { withCronRun } from '@/lib/cron/heartbeat';
import { puedeUsarIa } from '@/lib/wallet/puerta';

/**
 * "Aplicar mejoras solas" (workspaces.mejoras_automaticas).
 *
 * Cada 15 minutos, para los comercios que lo activaron:
 *   - el feedback nuevo de la bandeja con 5 minutos de reposo (quien marca
 *     suele corregir la nota enseguida) se convierte en un lote de reglas que
 *     se aplican solas;
 *   - las pruebas con feedback y sin propuestas, quietas hace 10 minutos (la
 *     prueba terminó), igual.
 * Lo que no se arregla con una regla va a la cola del equipo de Riverz.
 */
const MAX_PRUEBAS_POR_CORRIDA = 5;

async function handler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }
  const admin = supabaseAdmin();
  const { data: cuentas } = await admin.from('workspaces').select('id').eq('mejoras_automaticas', true);
  const resultado = { comercios: 0, lotes: 0, pruebas: 0, fallos: 0 };

  for (const { id: workspaceId } of (cuentas ?? []) as Array<{ id: string }>) {
    // Sin saldo no se gasta en mejorar: lo automático no puede cobrarle a nadie
    // lo que el comercio no pidió en el momento.
    if (!(await puedeUsarIa(admin, workspaceId))) continue;
    resultado.comercios++;

    const reposo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await admin
      .from('ai_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('estado', 'nuevo')
      .lte('updated_at', reposo);
    if ((count ?? 0) > 0) {
      const r = await mejorarFeedbackReal(admin, workspaceId, { automatico: true }).catch(() => 'fallo' as const);
      if (r === 'fallo') resultado.fallos++;
      else if (r !== 'sin_feedback') resultado.lotes++;
    }

    const quietas = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: pruebas } = await admin
      .from('ai_test_sessions')
      .select('id, feedback')
      .eq('workspace_id', workspaceId)
      .is('propuestas', null)
      .lte('updated_at', quietas)
      .order('updated_at', { ascending: false })
      .limit(20);
    const conFeedback = ((pruebas ?? []) as Array<{ id: string; feedback: unknown }>)
      .filter((p) => Array.isArray(p.feedback) && p.feedback.length > 0)
      .slice(0, MAX_PRUEBAS_POR_CORRIDA);
    for (const p of conFeedback) {
      const r = await mejorarSesionDePrueba(admin, workspaceId, p.id).catch(() => 'fallo' as const);
      if (r === 'fallo') resultado.fallos++;
      else if (typeof r === 'object') resultado.pruebas++;
    }
  }
  return NextResponse.json(resultado, { status: resultado.fallos ? 207 : 200 });
}

export const GET = withCronRun('mejoras', handler);
export const POST = GET;
export const dynamic = 'force-dynamic';
