/**
 * Pure helpers for turning the template-builder form into the component
 * array Meta's create-template endpoint expects, plus the validation Meta
 * enforces (so we fail at submit time with a readable message instead of a
 * 400 from the Graph API).
 *
 * Kept side-effect-free so it can be unit-tested and reused by the live
 * WhatsApp preview in the builder UI.
 */

import { marcarEnlace, marcarEnlaces } from '@/lib/marketing/enlaces'

import type {
  MetaTemplateCategory,
  MetaTemplateComponentInput,
} from './meta-api'
import {
  dynamicButtonTemplateUrl,
  dynamicButtonExampleUrl,
  type ButtonUrlVariable,
} from './dynamic-links'

export type TemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document'

export interface TemplateButtonInput {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
  text: string
  /** For URL buttons. */
  url?: string
  /** For a DYNAMIC URL button: which per-customer link fills it at send time
   *  (carrito abandonado, estado del pedido, tracking...). Cuando está presente
   *  el botón se manda a Meta como URL dinámica `dominio/{{1}}` y `url` se
   *  ignora. */
  url_variable?: ButtonUrlVariable
  /** For PHONE_NUMBER buttons (E.164). */
  phone_number?: string
}

export interface TemplateFormInput {
  category: MetaTemplateCategory
  headerType: TemplateHeaderType
  /** Header text (when headerType === 'text'). May contain a single {{1}}. */
  headerText?: string
  /** Resumable-upload handle for a media header sample (image/video/document). */
  headerHandle?: string
  bodyText: string
  footerText?: string
  buttons?: TemplateButtonInput[]
  /** One sample value per {{n}} variable found in bodyText, in order. */
  bodySamples?: string[]
}

/**
 * Find {{1}}, {{2}}, … placeholders in order of their number. Returns the
 * distinct, sorted variable indices.
 */
export function extractVariables(text: string): number[] {
  const found = new Set<number>()
  const re = /\{\{\s*(\d+)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    found.add(Number(m[1]))
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * Meta requires variables to be a contiguous run starting at 1: {{1}}, {{2}}…
 * Returns an error string, or null when valid.
 */
export function validateVariableSequence(text: string): string | null {
  const vars = extractVariables(text)
  if (vars.length === 0) return null
  for (let i = 0; i < vars.length; i++) {
    if (vars[i] !== i + 1) {
      return `Las variables deben ser correlativas empezando en {{1}} (encontrado {{${vars[i]}}} en la posición ${i + 1}).`
    }
  }
  return null
}

/** Normalize a free-text name into Meta's lowercase snake_case requirement. */
export function normalizeTemplateName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // A person writes words; Meta requires their separators to be `_`.
    // Treat spaces, hyphens and punctuation alike so the field never makes
    // someone rewrite the same title in a machine-only format.
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 512)
}

export interface BuildComponentsResult {
  components: MetaTemplateComponentInput[]
  error: string | null
}

/**
 * Build the Meta component array from the form. Validates as it goes and
 * returns the first error instead of throwing, so callers (route + preview)
 * can surface it the same way.
 */
export function buildTemplateComponents(
  form: TemplateFormInput
): BuildComponentsResult {
  const components: MetaTemplateComponentInput[] = []

  // ---- HEADER ----
  if (form.headerType === 'text') {
    const headerText = (form.headerText ?? '').trim()
    if (!headerText) {
      return { components, error: 'El encabezado de texto no puede estar vacío.' }
    }
    if (headerText.length > 60) {
      return { components, error: 'El encabezado no puede superar 60 caracteres.' }
    }
    const headerVars = extractVariables(headerText)
    if (headerVars.length > 1 || (headerVars.length === 1 && headerVars[0] !== 1)) {
      return {
        components,
        error: 'El encabezado de texto solo admite una variable {{1}}.',
      }
    }
    const header: MetaTemplateComponentInput = { type: 'HEADER', format: 'TEXT', text: headerText }
    if (headerVars.length === 1) {
      header.example = { header_text: ['ejemplo'] }
    }
    components.push(header)
  } else if (
    form.headerType === 'image' ||
    form.headerType === 'video' ||
    form.headerType === 'document'
  ) {
    if (!form.headerHandle) {
      return {
        components,
        error:
          'Los encabezados multimedia requieren subir un archivo de ejemplo primero.',
      }
    }
    components.push({
      type: 'HEADER',
      format: form.headerType.toUpperCase() as 'IMAGE' | 'VIDEO' | 'DOCUMENT',
      example: { header_handle: [form.headerHandle] },
    })
  }

  // ---- BODY (required) ----
  // Un link escrito a mano en el cuerpo también se marca, y por la misma
  // razón que el botón: el texto queda aprobado tal cual en Meta y después no
  // hay dónde tocarlo.
  const bodyText = marcarEnlaces((form.bodyText ?? '').trim(), {
    medio: 'plantilla',
  })
  if (!bodyText) {
    return { components, error: 'El cuerpo del mensaje es obligatorio.' }
  }
  if (bodyText.length > 1024) {
    return { components, error: 'El cuerpo no puede superar 1024 caracteres.' }
  }
  const seqError = validateVariableSequence(bodyText)
  if (seqError) return { components, error: seqError }

  const bodyVars = extractVariables(bodyText)
  const body: MetaTemplateComponentInput = { type: 'BODY', text: bodyText }
  if (bodyVars.length > 0) {
    const samples = form.bodySamples ?? []
    if (samples.length < bodyVars.length || samples.some((s) => !s?.trim())) {
      return {
        components,
        error: `Proporciona un valor de ejemplo para cada variable (${bodyVars.length}).`,
      }
    }
    body.example = { body_text: [bodyVars.map((_, i) => samples[i].trim())] }
  }
  components.push(body)

  // ---- FOOTER ----
  const footerText = (form.footerText ?? '').trim()
  if (footerText) {
    if (footerText.length > 60) {
      return { components, error: 'El pie no puede superar 60 caracteres.' }
    }
    components.push({ type: 'FOOTER', text: footerText })
  }

  // ---- BUTTONS ----
  const buttons = (form.buttons ?? []).filter((b) => b.text?.trim())
  if (buttons.length > 0) {
    if (buttons.length > 10) {
      return { components, error: 'Máximo 10 botones por plantilla.' }
    }
    const metaButtons: Array<Record<string, unknown>> = []
    for (const b of buttons) {
      if (b.text.length > 25) {
        return { components, error: `El texto del botón "${b.text}" supera 25 caracteres.` }
      }
      if (b.type === 'URL') {
        if (b.url_variable) {
          // Botón dinámico: dominio fijo + {{1}}. Meta exige un `example` con
          // una URL completa de muestra. El valor real de {{1}} (el token del
          // short link) se pasa al ENVIAR, no acá.
          metaButtons.push({
            type: 'URL',
            text: b.text,
            url: dynamicButtonTemplateUrl(),
            example: [dynamicButtonExampleUrl()],
          })
        } else {
          if (!b.url?.trim()) {
            return { components, error: `El botón "${b.text}" necesita una URL.` }
          }
          // Botón fijo: la URL queda congelada en la plantilla aprobada, así
          // que ésta es la ÚNICA oportunidad de marcarla. Sin esto, una
          // campaña que vende no tenía con qué probarlo y su plata caía en
          // «influidas» para siempre — el peor lugar donde perder crédito,
          // porque la campaña es justamente lo que el comercio nos paga.
          metaButtons.push({
            type: 'URL',
            text: b.text,
            url: marcarEnlace(b.url.trim(), { medio: 'plantilla' }),
          })
        }
      } else if (b.type === 'PHONE_NUMBER') {
        if (!b.phone_number?.trim()) {
          return { components, error: `El botón "${b.text}" necesita un teléfono.` }
        }
        metaButtons.push({ type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number.trim() })
      } else {
        metaButtons.push({ type: 'QUICK_REPLY', text: b.text })
      }
    }
    components.push({ type: 'BUTTONS', buttons: metaButtons })
  }

  return { components, error: null }
}
