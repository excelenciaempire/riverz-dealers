import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { adminGet } from '@/lib/admin/route';
import { recordAdminAction } from '@/lib/admin/audit';
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
export async function GET(request: Request) {
  return adminGet(request, { action: 'view.platform_whatsapp' }, () =>
    platformWhatsAppStatus(),
  );
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
    technicalAlertPhone?: string;
    technicalAlertEmail?: string;
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
      ...(Object.hasOwn(body, 'technicalAlertPhone')
        ? { technicalAlertPhone: body.technicalAlertPhone?.trim() || null }
        : {}),
      ...(Object.hasOwn(body, 'technicalAlertEmail')
        ? { technicalAlertEmail: body.technicalAlertEmail?.trim() || null }
        : {}),
    },
    gate.actor.userId,
  );
  if (!result.ok) {
    // El caso típico: falta aplicar la migración 147.
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Queda registrado, como todas las mutaciones del panel. Estas dos —ésta y la
  // del alta guiada— eran las únicas que escribían credenciales de plataforma
  // sin dejar rastro. El token nunca entra en la auditoría; sólo si cambió.
  await recordAdminAction(gate.actor, request, {
    action: 'update.platform_whatsapp',
    targetType: 'platform',
    meta: {
      phone_number_id: body.phoneNumberId?.trim() || null,
      token_changed: Boolean(body.token?.trim()),
      is_active: body.isActive === true,
      technical_alert_phone_changed: Object.hasOwn(body, 'technicalAlertPhone'),
      technical_alert_email_changed: Object.hasOwn(body, 'technicalAlertEmail'),
      via: 'manual',
    },
  });

  return NextResponse.json(await platformWhatsAppStatus());
}
