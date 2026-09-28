import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { platformTechnicalAlertRecipients, platformWhatsAppStatus, sendPlatformAlert } from '@/lib/admin/platform-whatsapp';
import { csrfGuard } from '@/lib/csrf';
import { limitByKey, rateLimitResponse } from '@/lib/rate-limit';
import { translate } from '@/lib/i18n/translate';

export const dynamic = 'force-dynamic';
/** Sends only a fixed test to the configured administrator, never arbitrary recipients. */
export async function POST(request: Request) {
  const csrf = await csrfGuard(request);
  if (csrf) return csrf;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const rate = await limitByKey(`admin:alert-test:${gate.actor.email}`, { limit: 1, windowMs: 60_000 });
  if (!rate.success) return rateLimitResponse(rate);
  const [recipients, status] = await Promise.all([platformTechnicalAlertRecipients(), platformWhatsAppStatus()]);
  if (!recipients.phone || !status.configured || !status.templateName)
    return NextResponse.json({ error: 'platform_alert_not_configured' }, { status: 409 });
  const locale = status.templateLanguage.startsWith('en') ? 'en' : 'es';
  const result = await sendPlatformAlert({
    to: recipients.phone,
    title: translate(locale, 'admin.platformAlertTestTitle'),
    body: translate(locale, 'admin.platformAlertTestBody'),
  });
  const accepted = result.ok && Boolean(result.messageId);
  await recordAdminAction(gate.actor, request, {
    action: 'test.platform_alert', targetType: 'platform',
    meta: { accepted, message_id: result.messageId ?? null, error_code: result.errorCode ?? null },
  });
  return NextResponse.json({ accepted, messageId: result.messageId ?? null, errorCode: result.errorCode ?? null }, {
    status: accepted ? 200 : 502, headers: { 'Cache-Control': 'no-store' },
  });
}
