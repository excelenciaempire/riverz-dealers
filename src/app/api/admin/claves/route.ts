import { NextResponse } from 'next/server';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet } from '@/lib/admin/route';
import { recordAdminAction } from '@/lib/admin/audit';
import { borrarClave, guardarClave, leerEstadoDeClaves } from '@/lib/admin/claves';

export const dynamic = 'force-dynamic';

/**
 * Las llaves globales de IA y voz — SÓLO equipo de plataforma.
 *
 * GET → el estado de cada una: de dónde sale (panel o Render), su pista y qué
 *       conceptos de la billetera dependen de ella. **Nunca el texto plano.**
 * PUT → cargar o cambiar una (`{ proveedor, clave }`), o quitarla del panel
 *       (`{ proveedor, clave: '' }`), que la devuelve a la variable de Render.
 *
 * Tres puertas, como toda escritura del panel: el token CSRF, ser del equipo y
 * la contraseña del panel (que `requireAdmin` ya exige). Y cada cambio queda en
 * `admin_audit_log` con quién y cuál — nunca con el valor.
 */
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.keys' }, async () => ({
    claves: await leerEstadoDeClaves(),
  }));
}

export async function PUT(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    proveedor?: string;
    clave?: string;
  } | null;
  if (!body?.proveedor) {
    return NextResponse.json({ error: 'proveedor required' }, { status: 400 });
  }

  // Vacío = quitarla del panel. No apaga al proveedor: vuelve a la de Render.
  const quitar = !body.clave?.trim();
  const res = quitar
    ? await borrarClave(body.proveedor)
    : await guardarClave(body.proveedor, body.clave as string, gate.actor.userId);

  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  // Se espera a que quede escrita: es una acción, no una lectura, y si la
  // auditoría falla es mejor saberlo ahora.
  await recordAdminAction(gate.actor, request, {
    action: quitar ? 'delete.platform_key' : 'update.platform_key',
    targetType: 'provider',
    targetId: body.proveedor,
  });

  return NextResponse.json({ claves: await leerEstadoDeClaves() });
}
