import { supabaseAdmin } from '@/lib/automations/admin-client';
import { listConnections } from '@/lib/channels/connections';
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
  /** El teléfono se muestra sólo al administrador, nunca a un comercio. */
  technicalAlertPhone: string | null;
  technicalAlertEmail: string | null;
  /** La tabla existe, pero aún le faltan las columnas de la migración 248. */
  needsTechnicalRecipientsMigration: boolean;
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
  technical_alert_phone?: string | null;
  technical_alert_email?: string | null;
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
  // `select('*')` no incluye una columna que todavía no existe. Esto permite
  // desplegar el código antes de aplicar 248 sin romper el emisor ni perder el
  // respaldo actual de Render.
  const hasTechnicalColumns = Boolean(
    row && Object.hasOwn(row, 'technical_alert_phone') && Object.hasOwn(row, 'technical_alert_email'),
  );
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
    technicalAlertPhone: row?.technical_alert_phone || process.env.PLATFORM_ALERT_PHONE || null,
    technicalAlertEmail: row?.technical_alert_email || process.env.PLATFORM_ALERT_EMAIL || null,
    needsTechnicalRecipientsMigration: !missing && !hasTechnicalColumns,
  };
}

/** Destinatarios exclusivos de los avisos técnicos internos. */
export async function platformTechnicalAlertRecipients(): Promise<{
  phone: string | null;
  email: string | null;
}> {
  const { row } = await readRow();
  return {
    phone: row?.technical_alert_phone || process.env.PLATFORM_ALERT_PHONE || null,
    email: row?.technical_alert_email || process.env.PLATFORM_ALERT_EMAIL || null,
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
export function paramSeguro(v: string): string {
  // Las líneas del vigilante ya empiezan con "· ": unirlas con otro "·" las
  // mostraba como "errores: a · · Trabajo con errores: b".
  return v
    .split('\n')
    .map((linea) => linea.trim().replace(/^·\s*/, ''))
    .filter(Boolean)
    .join(' · ')
    .replace(/\t/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
}

/**
 * ¿Ese número es una línea de WhatsApp de la API —nuestra o de un comercio— en
 * vez del teléfono de una persona?
 *
 * Se comparan dígitos normalizados: la misma línea figura como
 * «+54 9 11 7678-3848» en la conexión y como `5491176783848` en el destino.
 *
 * Si la consulta falla se deja pasar el aviso: un error de base no puede dejar
 * mudo al sistema de avisos, que es lo contrario de lo que se está arreglando.
 */
async function esLineaDeApi(
  destino: string,
  propio: string | null,
): Promise<boolean> {
  const { normalizeToWhatsApp } = await import('@/lib/whatsapp/phone-utils');
  if (propio && normalizeToWhatsApp(propio) === destino) return true;
  try {
    // Paginada: PostgREST corta en 1000 sin avisar, y acá el corte se leería
    // como "ese número no es de la API" — o sea, un aviso mandado a una línea
    // que sí es nuestra.
    const filas = await listConnections(supabaseAdmin(), {
      channel: 'whatsapp',
      select: 'id, config',
    });
    for (const fila of filas) {
      const numero = (fila.config?.display_phone_number as string | undefined) ?? '';
      if (numero && normalizeToWhatsApp(numero) === destino) return true;
    }
  } catch (e) {
    console.error('[avisos] no se pudo comprobar si el destino es una línea de la API', e);
  }
  return false;
}

export async function sendPlatformAlert(args: {
  /** El número, en cualquier formato. Se normaliza acá. */
  to: string;
  /** Título corto: primer parámetro de la plantilla. */
  title: string;
  /** El cuerpo. En texto libre va entero; en plantilla, como segundo parámetro. */
  body: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string; errorCode?: number; httpStatus?: number }> {
  const plataforma = await platformWhatsApp();
  if (!plataforma) {
    return { ok: false, error: 'el WhatsApp de Riverz no está configurado' };
  }

  // El número, en el formato que marca WhatsApp.
  //
  // No alcanza con sacarle el `+`: en Argentina un móvil escrito sin el `9`
  // —«+54 11 6104-7646»— es un número perfectamente válido que Meta no entrega.
  // `normalizeToWhatsApp` es la misma función que usa el resto del sistema para
  // hablarle a un cliente, así que un aviso de plataforma llega exactamente a
  // donde llegaría un mensaje del agente. Se hace en el ÚNICO lugar por donde
  // pasan todos los avisos, para no tener que acordarse en cada uno.
  const { normalizeToWhatsApp } = await import('@/lib/whatsapp/phone-utils');
  const destino = normalizeToWhatsApp(args.to);
  if (!destino) return { ok: false, error: 'el número está vacío' };

  // Un aviso a una línea de la Cloud API no lo lee nadie.
  //
  // Los números de `channel_connections` no son teléfonos: son líneas de la API
  // de Meta. Lo que se les manda no aparece en el WhatsApp de ninguna persona —
  // vuelve por el webhook como `type: unsupported` y aterriza en la bandeja del
  // propio comercio, como si un cliente hubiera mandado algo ilegible. Peor: la
  // IA lo contesta y lo escala, y esa escalada dispara otro aviso al mismo
  // lugar. Verificado en la cuenta Pilar el 2026-08-30 (9 de 9 escaladas del
  // día). El corte va acá, en el único lugar por donde pasan TODOS los avisos,
  // para que ningún camino nuevo vuelva a caer en el pozo.
  if (await esLineaDeApi(destino, plataforma.displayPhoneNumber)) {
    console.warn('[avisos] destino descartado: es una línea de la API, no un teléfono');
    return { ok: false, error: 'el destino es una línea de WhatsApp API, no un teléfono' };
  }

  const { sendTemplateMessage, sendTextMessage } = await import('@/lib/whatsapp/meta-api');
  try {
    if (plataforma.templateName) {
      const res = await sendTemplateMessage({
        phoneNumberId: plataforma.phoneNumberId,
        accessToken: plataforma.token,
        to: destino,
        templateName: plataforma.templateName,
        language: plataforma.templateLanguage,
        params: [paramSeguro(args.title), paramSeguro(args.body)],
      });
      return { ok: true, messageId: res.messageId ?? undefined };
    }
    const res = await sendTextMessage({
      phoneNumberId: plataforma.phoneNumberId,
      accessToken: plataforma.token,
      to: destino,
      text: `${args.title}\n\n${args.body}`,
    });
    return { ok: true, messageId: res.messageId ?? undefined };
  } catch (err) {
    const meta = err as { code?: unknown; status?: unknown } | null;
    return {
      ok: false, error: err instanceof Error ? err.message : 'no se pudo avisar',
      ...(typeof meta?.code === 'number' ? { errorCode: meta.code } : {}),
      ...(typeof meta?.status === 'number' ? { httpStatus: meta.status } : {}),
    };
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
  technicalAlertPhone?: string | null;
  technicalAlertEmail?: string | null;
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
  if (input.technicalAlertPhone !== undefined)
    patch.technical_alert_phone = input.technicalAlertPhone;
  if (input.technicalAlertEmail !== undefined)
    patch.technical_alert_email = input.technicalAlertEmail;
  const token = (input.token ?? '').trim();
  if (token) patch.access_token_encrypted = encrypt(token);

  const { error } = await supabaseAdmin()
    .from('platform_whatsapp_settings')
    .upsert(patch, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
