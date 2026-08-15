import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { csrfGuard } from '@/lib/csrf';
import {
  platformWhatsAppStatus,
  savePlatformWhatsApp,
} from '@/lib/admin/platform-whatsapp';

/**
 * GET  /api/admin/whatsapp — estado de la conexión de plataforma (sin token).
 * POST /api/admin/whatsapp — guarda número, WABA, plantilla y token.
 *
 * El token entra pero no sale: la pantalla sólo sabe si hay uno puesto.
 */
export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  return NextResponse.json(await platformWhatsAppStatus());
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;

  const body = (await request.json().catch(() => null)) as {
    phoneNumberId?: string;
    wabaId?: string;
    displayPhoneNumber?: string;
    token?: string;
    templateName?: string;
    templateLanguage?: string;
    isActive?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const result = await savePlatformWhatsApp(
    {
      phoneNumberId: body.phoneNumberId?.trim() || null,
      wabaId: body.wabaId?.trim() || null,
      displayPhoneNumber: body.displayPhoneNumber?.trim() || null,
      token: body.token,
      templateName: body.templateName?.trim() || null,
      templateLanguage: body.templateLanguage?.trim() || 'es',
      isActive: body.isActive === true,
    },
    gate.actor.userId,
  );
  if (!result.ok) {
    // El caso típico: falta aplicar la migración 147.
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json(await platformWhatsAppStatus());
}
