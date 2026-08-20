import { supabaseAdmin } from '@/lib/automations/admin-client';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

/**
 * El WhatsApp de Riverz — el de la plataforma, no el de un comercio.
 *
 * Por qué separado: el aviso más importante que manda Riverz es "tu WhatsApp
 * está bloqueado". Si sale por el número del propio comercio, ese aviso es
 * justo el que no se puede entregar. Además, con muchos comercios la
 * plataforma tiene que poder escribirle a cualquiera sin entrar a su espacio
 * de trabajo — igual que la clave de Anthropic de la plataforma vive aparte de
 * las que pone cada cuenta.
 *
 * Se lee de la tabla (migración 147) y, si no hay fila, del entorno: así el
 * despliegue funciona antes de aplicar la migración y en local.
 */
export interface PlatformWhatsApp {
  phoneNumberId: string;
  token: string;
  templateName: string | null;
  templateLanguage: string;
  displayPhoneNumber: string | null;
}

/** Lo que la pantalla de /admin puede ver: nunca el token. */
export interface PlatformWhatsAppStatus {
  configured: boolean;
  active: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  templateName: string | null;
  templateLanguage: string;
  hasToken: boolean;
  updatedAt: string | null;
  /** La tabla todavía no existe (falta aplicar la migración 147). */
  needsMigration: boolean;
}

interface Row {
  phone_number_id: string | null;
  waba_id: string | null;
  display_phone_number: string | null;
  access_token_encrypted: string | null;
  alert_template_name: string | null;
  alert_template_language: string | null;
  is_active: boolean;
  updated_at: string;
}

async function readRow(): Promise<{ row: Row | null; missing: boolean }> {
  const { data, error } = await supabaseAdmin()
    .from('platform_whatsapp_settings')
    .select('*')
    .maybeSingle();
  // 42P01 = la tabla no existe todavía.
  if (error && /relation .* does not exist|42P01/i.test(error.message ?? '')) {
    return { row: null, missing: true };
  }
  return { row: (data as Row | null) ?? null, missing: false };
}

export async function platformWhatsAppStatus(): Promise<PlatformWhatsAppStatus> {
  const { row, missing } = await readRow();
  const envPhone = process.env.PLATFORM_WHATSAPP_PHONE_ID ?? null;
  const envToken = process.env.PLATFORM_WHATSAPP_TOKEN ?? null;

  const phoneNumberId = row?.phone_number_id ?? envPhone;
  const hasToken = Boolean(row?.access_token_encrypted || envToken);
  return {
    configured: Boolean(phoneNumberId && hasToken),
    active: row ? row.is_active : Boolean(envPhone && envToken),
    phoneNumberId,
    wabaId: row?.waba_id ?? null,
    displayPhoneNumber: row?.display_phone_number ?? null,
    templateName: row?.alert_template_name ?? process.env.PLATFORM_WHATSAPP_TEMPLATE ?? null,
    templateLanguage: row?.alert_template_language ?? 'es',
    hasToken,
    updatedAt: row?.updated_at ?? null,
    needsMigration: missing,
  };
}

/** Credenciales listas para mandar, o null si no hay con qué. */
export async function platformWhatsApp(): Promise<PlatformWhatsApp | null> {
  const { row } = await readRow();
  if (row?.is_active && row.phone_number_id && row.access_token_encrypted) {
    try {
      return {
        phoneNumberId: row.phone_number_id,
        token: decrypt(row.access_token_encrypted),
        templateName: row.alert_template_name,
        templateLanguage: row.alert_template_language ?? 'es',
        displayPhoneNumber: row.display_phone_number,
      };
    } catch {
      /* token corrupto: cae al entorno */
    }
  }
  const phoneNumberId = process.env.PLATFORM_WHATSAPP_PHONE_ID;
  const token = process.env.PLATFORM_WHATSAPP_TOKEN;
  if (!phoneNumberId || !token) return null;
  return {
    phoneNumberId,
    token,
    templateName: process.env.PLATFORM_WHATSAPP_TEMPLATE ?? null,
    templateLanguage: 'es',
    displayPhoneNumber: null,
  };
}

/**
 * Manda un aviso por el WhatsApp de Riverz.
 *
 * Con plantilla si hay una configurada, con texto libre si no. La diferencia no
 * es de estilo: **Meta sólo entrega texto libre dentro de las 24 h posteriores a
 * que la persona nos escriba**. Un aviso que sale por texto libre funciona el
 * día que lo probás —porque acabás de escribirle al número— y deja de salir en
 * silencio al día siguiente, que es el peor modo de falla posible para algo
 * cuya única función es avisar.
 *
 * Vive acá y no en cada llamador porque son dos —las aprobaciones y el
 * vigilante de plataforma— y el segundo se había escrito sólo con texto libre.
 */
/**
 * Un parámetro de plantilla no admite saltos de línea, tabulaciones ni cuatro
 * espacios seguidos: Meta los rechaza con (#132018) "There's an issue with the
 * parameters in your template". El vigilante arma el cuerpo como una lista de
 * líneas, así que TODOS sus avisos por WhatsApp venían fallando — y como el
 * error se registraba y se seguía, el aviso quedaba sólo en el correo sin que
 * nadie se enterara de por qué.
 */
function paramSeguro(v: string): string {
  return v.replace(/\s*\n\s*/g, ' · ').replace(/\t/g, ' ').replace(/ {4,}/g, '   ').trim();
}

export async function sendPlatformAlert(args: {
  to: string;
  /** Título corto: primer parámetro de la plantilla. */
  title: string;
  /** El cuerpo. En texto libre va entero; en plantilla, como segundo parámetro. */
  body: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const plataforma = await platformWhatsApp();
  if (!plataforma) {
    return { ok: false, error: 'el WhatsApp de Riverz no está configurado' };
  }

  const { sendTemplateMessage, sendTextMessage } = await import('@/lib/whatsapp/meta-api');
  try {
    if (plataforma.templateName) {
      const res = await sendTemplateMessage({
        phoneNumberId: plataforma.phoneNumberId,
        accessToken: plataforma.token,
        to: args.to,
        templateName: plataforma.templateName,
        language: plataforma.templateLanguage,
        params: [paramSeguro(args.title), paramSeguro(args.body)],
      });
      return { ok: true, messageId: res.messageId ?? undefined };
    }
    const res = await sendTextMessage({
      phoneNumberId: plataforma.phoneNumberId,
      accessToken: plataforma.token,
      to: args.to,
      text: `${args.title}\n\n${args.body}`,
    });
    return { ok: true, messageId: res.messageId ?? undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'no se pudo avisar' };
  }
}

export interface PlatformWhatsAppInput {
  phoneNumberId?: string | null;
  wabaId?: string | null;
  displayPhoneNumber?: string | null;
  token?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  isActive?: boolean;
}

/** Guarda la configuración. Un token vacío NO borra el que ya estaba. */
export async function savePlatformWhatsApp(
  input: PlatformWhatsAppInput,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = {
    id: true,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  };
  if (input.phoneNumberId !== undefined) patch.phone_number_id = input.phoneNumberId;
  if (input.wabaId !== undefined) patch.waba_id = input.wabaId;
  if (input.displayPhoneNumber !== undefined)
    patch.display_phone_number = input.displayPhoneNumber;
  if (input.templateName !== undefined) patch.alert_template_name = input.templateName;
  if (input.templateLanguage !== undefined)
    patch.alert_template_language = input.templateLanguage;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  const token = (input.token ?? '').trim();
  if (token) patch.access_token_encrypted = encrypt(token);

  const { error } = await supabaseAdmin()
    .from('platform_whatsapp_settings')
    .upsert(patch, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
