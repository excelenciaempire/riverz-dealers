import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { widgetKey } from '@/lib/channels/webchat/token';
import {
  getThemeExtensionSetup,
  prepareThemeExtension,
} from '@/lib/shopify/theme-extension';

/**
 * Preparar el app embed sin tocar código del tema.
 *
 * GET  — devuelve si se puede activar y el deep link del editor.
 * POST — sincroniza el metafield y devuelve el mismo deep link.
 * DELETE — conserva el embed; el switch del canal lo deja inerte.
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
  const resolved = await getThemeExtensionSetup(ctx.admin, ctx.workspaceId);
  if (!resolved.ok) {
    return NextResponse.json({ available: false, reason: resolved.error });
  }
  return NextResponse.json({
    available: true,
    activation_url: resolved.setup.activationUrl,
    shop: resolved.setup.shopDomain,
  });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = await prepareThemeExtension(
    ctx.admin,
    ctx.workspaceId,
    widgetKey(ctx.workspaceId),
  );
  return NextResponse.json(
    res.ok
      ? {
          ok: true,
          activation_url: res.setup.activationUrl,
          shop: res.setup.shopDomain,
        }
      : res,
    { status: res.ok ? 200 : 400 },
  );
}

export async function DELETE(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, embedded: true });
}
