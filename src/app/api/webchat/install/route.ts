import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { widgetKey } from '@/lib/channels/webchat/token';
import {
  desinstalarWidget,
  instalarWidget,
  widgetInstalado,
} from '@/lib/shopify/script-tag';

/**
 * Poner o sacar el chat de la tienda, sin tocar el código del tema.
 *
 * GET  — ¿está puesto? `null` cuando no hay Shopify o no se pudo preguntar.
 * POST — lo pone. DELETE — lo saca.
 *
 * Copiar un snippet a `theme.liquid` es el paso donde se cae la adopción: el
 * comercio conectó la tienda en dos clics y de golpe tiene que abrir el editor
 * de código. Esto lo hace por él.
 */
export const dynamic = 'force-dynamic';

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  if (!workspaceId) return null;
  return { admin, workspaceId };
}

export async function GET() {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await widgetInstalado(ctx.admin, ctx.workspaceId));
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // El origen sale de la petición y no de una variable de entorno: así el
  // widget instalado apunta al mismo dominio desde el que el comercio lo
  // instaló, y una vista previa no le mete el de producción en su tienda.
  const base = new URL(request.url).origin;
  const res = await instalarWidget(
    ctx.admin,
    ctx.workspaceId,
    widgetKey(ctx.workspaceId),
    base,
  );
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const res = await desinstalarWidget(ctx.admin, ctx.workspaceId);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
