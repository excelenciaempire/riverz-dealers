import type { TFn } from '@/lib/i18n/translate';
const PURPOSES: Record<string, string> = {
  respuesta: 'settings.walletPurposeReply',
  reescritura: 'settings.walletPurposeRewrite',
  cierre_sin_respuesta: 'settings.walletPurposeClosure',
  escalada: 'settings.walletPurposeEscalation',
  escalada_por_que: 'settings.walletPurposeEscalationNote',
};
export function movementContext(
  detail: Record<string, unknown> | undefined,
  t: TFn
): string | null {
  const purpose =
    typeof detail?.para === 'string' ? PURPOSES[detail.para] : undefined;
  const channel =
    typeof detail?.canal === 'string'
      ? (
          {
            whatsapp: 'WhatsApp',
            gmail: 'Gmail',
            outlook: 'Outlook/Hotmail',
            zoho: 'Zoho',
            instagram: 'Instagram',
            messenger: 'Messenger',
            ig_comment: 'Instagram',
            fb_comment: 'Facebook',
          } as Record<string, string>
        )[detail.canal]
      : null;
  return (
    [purpose ? t(purpose) : null, channel].filter(Boolean).join(' · ') || null
  );
}
const REASONS: Record<string, string> = {
  ia_respuesta: 'walletReasonReply',
  ia_clasificacion: 'walletReasonClassify',
  ia_resumen: 'walletReasonMemory',
  ia_seguimiento: 'walletReasonFollowup',
  ia_asistencia: 'walletReasonAssist',
  ia_operador: 'walletReasonOperator',
  transcripcion: 'walletReasonTranscribe',
  entender_publicacion: 'walletReasonPost',
  imagen_entrante: 'walletReasonImage',
  llamada_ia: 'walletReasonCallAI',
  llamada_voz: 'walletReasonCall',
  numero_telefono: 'walletReasonPhone',
  voz_stt: 'walletReasonTranscribe',
  voz_tts: 'walletReasonVoice',
  busqueda_web: 'walletReasonSearch',
  investigacion: 'walletReasonResearch',
  lectura_de_pagina: 'walletReasonPage',
  perfil_externo: 'walletReasonProfile',
};
export function movementReason(concept: string, t: TFn): string | null {
  const key = REASONS[concept];
  return key ? t(`settings.${key}`) : null;
}
export function movementTokens(
  detail: Record<string, unknown> | undefined
): number | null {
  const usage = detail?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  if (u.prompt_tokens !== undefined || u.completion_tokens !== undefined) {
    const values = [u.prompt_tokens ?? 0, u.completion_tokens ?? 0];
    if (
      values.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)
    )
      return null;
    const total = (values as number[]).reduce((a, b) => a + b, 0);
    return total > 0 ? total : null;
  }
  const values = [
    'input_tokens',
    'output_tokens',
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
  ].map((k) => u[k] ?? 0);
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0))
    return null;
  const total = (values as number[]).reduce((a, b) => a + b, 0);
  return total > 0 ? total : null;
}
