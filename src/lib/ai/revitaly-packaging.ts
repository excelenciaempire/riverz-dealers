import type { SupabaseClient } from '@supabase/supabase-js';
import type { Regla } from './guidance';
import { REVITALY_EMAIL_WORKSPACE } from '../channels/email/whatsapp-referral';

export const REVITALY_PACKAGING_RULE = 'revitaly_packaging_presentation_notice';
export const REVITALY_PACKAGING_TEMPLATE = 'revitaly_envase_presentacion_20261001';
export const REVITALY_PACKAGING_WAITING = 'revitaly_packaging_template_pending';
export const REVITALY_PACKAGING_NOTICE = `¡Hola! 😊 Queremos brindarte tranquilidad: el producto que recibiste es 100% original de Revitaly.

Debido a una falta temporal de stock de nuestro envase ámbar habitual por parte del proveedor, algunos pedidos fueron despachados en un envase negro de formato redondo.

Este cambio es únicamente de presentación: el contenido y la fórmula de Revitaly se mantienen sin modificaciones.

Gracias por tu comprensión y por confiar en nosotros. 🙌`;
/** Mercado Libre post-sale messages allow Latin-1 and at most 350 characters. */
export function revitalyPackagingChunks(notice: string, channel: string, thread?: string | null): string[] {
  if (channel !== 'mercadolibre' || !thread?.startsWith('pack:')) return [notice];
  const paragraphs = notice.split('\n\n').map(p => [...p].filter(c => c.codePointAt(0)! <= 255).join('').replace(/ {2,}/g, ' ').trim());
  if (paragraphs.some(p => p.length > 350)) throw new Error('packaging_notice_exceeds_ml_limit');
  return paragraphs;
}
const ENGLISH_NOTICE = `Hi! 😊 We want to reassure you: the product you received is 100% original Revitaly.

Due to a temporary shortage of our usual amber packaging from the supplier, some orders were shipped in a round black container.

This is only a change in presentation: Revitaly's contents and formula remain unchanged.

Thank you for your understanding and for trusting us. 🙌`;

/** Only the presentation change confirmed by the merchant; quantity, regulation and wrong products are separate cases. */
export function revitalyPackagingInquiry(workspaceId: string, input: string): { additionalIssue: boolean } | null {
  if (workspaceId !== REVITALY_EMAIL_WORKSPACE) return null;
  const current = input.split(/\n(?:El El |El (?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom)|On .+wrote:|[- ]*Mensaje original)/i)[0]
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n');
  const text = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!/\b(?:envases?|[34]nvases?|embases?|enbases?|frascos?|botellas?|empaques?|packaging|containers?|bottles?)\b/.test(text)) return null;
  if (/\b(anmat|regulator\w*|registro|lote|vencimiento|factura|fiscal|medic\w*|alerg\w*|abogad\w*|defensa del consumidor|refund|reembolso|cancel\w*)\b/.test(text)) return null;
  if (/\b(otro shampoo|otra marca|producto equivocado|wrong product|different brand)\b/.test(text)) return null;
  if (/\b(?:otro producto|producto distinto)\b(?!\s+de imitacion)/.test(text)) return null;
  const presentation = /\b(diferent\w*|distint\w*|incorrect\w*|equivocad\w*|cambi\w*|negros?|redond\w*|cilindric\w*|rectangular\w*|ambar|imitacion|original|copia|falsific\w*|different|wrong|black|round|amber|counterfeit|fake)\b/.test(text)
    || /\b(?:no (?:es|son|era|eran)|no coincide\w*|no (?:son )?los que)\b[\s\S]*\b(foto|public\w*|pagina|anunci\w*)\b/.test(text);
  if (!presentation) return null;
  return { additionalIssue: /\b(rot[oa]s?|rajad\w*|danad\w*|perdid\w*|derram\w*|dosificador\w*|faltantes?|faltan|falta un|falta una|no sale|no permite|no recibi|no llego|broken|leak\w*|damaged|missing)\b/.test(text)
    || /\b(?:quiero|necesito|puedo|hablar|speak|talk)\b.{0,70}\b(?:humano|persona|asesor|human|person)\b/.test(text) };
}

/** A Shopify contact form wraps a real customer's request; never reply to its mailer. */
export function revitalyPackagingFormEmail(workspaceId: string, from: string, input: string): string | null {
  if (!revitalyPackagingInquiry(workspaceId, input) || !/^mailer@shopify\.com$/i.test(from.trim())) return null;
  if (!/mensaje nuevo desde el formulario de contacto de tu\s+tienda online/i.test(input)) return null;
  const match = /Correo electr[oó]nico:\s*\r?\n([^\s<>]+@[^\s<>]+)\s*\r?\n/i.exec(input);
  const email = match?.[1];
  return email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !/@shopify\.com$/i.test(email) ? email : null;
}

export function revitalyPackagingNeedsContext(workspaceId:string,input:string,hasMedia:boolean):boolean {
  return workspaceId===REVITALY_EMAIL_WORKSPACE && !revitalyPackagingInquiry(workspaceId,input)
    && (hasMedia || /\b(original|originalidad|foto|imagen|negro|redondo|genuine|photo|picture)\b/i.test(input));
}

/** Customers often send “different container”, then a photo or “is it original?” before the reply. */
export function revitalyPackagingBurst(input:string,recent:Array<{sender_type:string;content_text?:string|null}>):string {
  const pending:string[]=[];
  for(const message of recent){
    if(message.sender_type!=='customer')break;
    if(message.content_text)pending.push(message.content_text);
  }
  return [...pending.reverse(),input].join('\n');
}

export function configuredRevitalyPackagingNotice(rules: Regla[], workspaceId: string, agentId?: string | null, language = 'es'): string | null {
  if (workspaceId !== REVITALY_EMAIL_WORKSPACE) return null;
  const matches = rules.filter(r => r.workspace_id === workspaceId && r.activa && r.clave === REVITALY_PACKAGING_RULE
    && (!r.agent_id || r.agent_id === agentId));
  if (matches.length !== 1 || !matches[0].hacer.includes(REVITALY_PACKAGING_NOTICE)) return null;
  return language.toLowerCase().startsWith('en') ? ENGLISH_NOTICE : REVITALY_PACKAGING_NOTICE;
}

export async function loadRevitalyPackagingNotice(db: SupabaseClient, workspaceId: string, inbound: string, language = 'es'): Promise<string | null> {
  if (!revitalyPackagingInquiry(workspaceId, inbound)) return null;
  const result = await db.from('agent_guidance').select('*').eq('workspace_id', workspaceId)
    .is('agent_id', null).eq('clave', REVITALY_PACKAGING_RULE).eq('activa', true);
  if (result.error) throw new Error('packaging_policy_unavailable');
  return configuredRevitalyPackagingNotice(result.data ?? [], workspaceId, null, language);
}
