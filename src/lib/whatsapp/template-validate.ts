/**
 * Validador inline de plantillas de WhatsApp Cloud API. Replica las
 * reglas que Meta aplica al revisar la plantilla, pero del lado del
 * cliente para que el merchant vea los problemas mientras escribe en
 * lugar de mandarla y esperar 24h por un "Rejected".
 *
 * Las reglas vienen de la doc oficial:
 * https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/
 *
 * Cada issue tiene `field` (qué campo del wizard apuntar), `severity`
 * (error bloquea el submit, warning solo avisa), `message` (texto al
 * grano, ya localizado) y `code` (para tracking).
 *
 * El validador recibe la función `t` (i18n) y resuelve cada mensaje en
 * el idioma activo. Es react-free, así que el llamador (TemplateBuilder)
 * le pasa su `t` de `useT()`.
 */

import type { TFn } from '@/lib/i18n/translate';

export type TemplateIssueSeverity = 'error' | 'warning';

export interface TemplateIssue {
  field:
    | 'name'
    | 'language'
    | 'category'
    | 'header'
    | 'body'
    | 'footer'
    | 'buttons'
    | `button.${number}`;
  severity: TemplateIssueSeverity;
  code: string;
  message: string;
}

export interface TemplateInput {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  headerType: 'none' | 'text' | 'image' | 'video' | 'document';
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phone_number?: string;
  }>;
  bodySamples?: string[];
}

const NAME_REGEX = /^[a-z0-9_]+$/;
const MAX_NAME = 512;
const MAX_HEADER = 60;
const MAX_BODY = 1024;
const MAX_FOOTER = 60;
const MAX_BUTTON_TEXT = 25;
const MAX_BUTTONS = 10;
const MAX_QUICK_REPLY = 3;
const MAX_URL_BUTTONS = 2;
const MAX_PHONE_BUTTONS = 1;
// Patrones que Meta rechaza típicamente. Cada uno lleva su `code` y el
// mensaje se resuelve vía i18n en el call site.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /\$\$+|!!+|\?\?+/, code: 'body_pattern_repeated' },
  { pattern: /[A-ZÁÉÍÓÚÑ]{6,}/u, code: 'body_pattern_caps' },
];

export function validateTemplate(input: TemplateInput, t: TFn): TemplateIssue[] {
  const issues: TemplateIssue[] = [];

  // Nombre
  if (!input.name.trim()) {
    issues.push({
      field: 'name',
      severity: 'error',
      code: 'name_required',
      message: t('templates.tplValidate_name_required'),
    });
  } else {
    if (input.name.length > MAX_NAME) {
      issues.push({
        field: 'name',
        severity: 'error',
        code: 'name_too_long',
        message: t('templates.tplValidate_name_too_long', { max: MAX_NAME }),
      });
    }
    if (!NAME_REGEX.test(input.name)) {
      issues.push({
        field: 'name',
        severity: 'error',
        code: 'name_format',
        message: t('templates.tplValidate_name_format'),
      });
    }
  }

  // Idioma
  if (!input.language) {
    issues.push({
      field: 'language',
      severity: 'error',
      code: 'language_required',
      message: t('templates.tplValidate_language_required'),
    });
  }

  // Header
  if (input.headerType === 'text') {
    if (!input.headerText?.trim()) {
      issues.push({
        field: 'header',
        severity: 'error',
        code: 'header_empty',
        message: t('templates.tplValidate_header_empty'),
      });
    } else if (input.headerText.length > MAX_HEADER) {
      issues.push({
        field: 'header',
        severity: 'error',
        code: 'header_too_long',
        message: t('templates.tplValidate_header_too_long', {
          max: MAX_HEADER,
          len: input.headerText.length,
        }),
      });
    }
    // Solo se permite una variable en el header.
    const headerVars = countVars(input.headerText ?? '');
    if (headerVars > 1) {
      issues.push({
        field: 'header',
        severity: 'error',
        code: 'header_too_many_vars',
        message: t('templates.tplValidate_header_too_many_vars'),
      });
    }
  }

  // Body
  if (!input.bodyText.trim()) {
    issues.push({
      field: 'body',
      severity: 'error',
      code: 'body_required',
      message: t('templates.tplValidate_body_required'),
    });
  } else {
    if (input.bodyText.length > MAX_BODY) {
      issues.push({
        field: 'body',
        severity: 'error',
        code: 'body_too_long',
        message: t('templates.tplValidate_body_too_long', {
          max: MAX_BODY,
          len: input.bodyText.length,
        }),
      });
    }
    const bodyVars = countVars(input.bodyText);
    if (bodyVars > 0 && input.bodySamples) {
      const missing: number[] = [];
      for (let i = 0; i < bodyVars; i++) {
        if (!input.bodySamples[i]?.trim()) missing.push(i + 1);
      }
      if (missing.length > 0) {
        issues.push({
          field: 'body',
          severity: 'warning',
          code: 'body_samples_missing',
          message: t('templates.tplValidate_body_samples_missing', {
            vars: `{{${missing.join('}}, {{')}}}`,
          }),
        });
      }
    }
    // Espacios en blanco al inicio o final no permitidos.
    if (input.bodyText !== input.bodyText.trim()) {
      issues.push({
        field: 'body',
        severity: 'error',
        code: 'body_whitespace',
        message: t('templates.tplValidate_body_whitespace'),
      });
    }
    // Meta rechaza plantillas cuyo cuerpo empieza o termina con una
    // variable ({{1}}): "Las variables no pueden estar al principio ni al
    // final de la plantilla." Lo atajamos acá para no gastar un ciclo de
    // revisión de Meta.
    const trimmedBody = input.bodyText.trim();
    if (/^\{\{\s*\d+\s*\}\}/.test(trimmedBody) || /\{\{\s*\d+\s*\}\}$/.test(trimmedBody)) {
      issues.push({
        field: 'body',
        severity: 'error',
        code: 'body_var_at_edge',
        message: t('templates.tplValidate_body_var_at_edge'),
      });
    }
    // Patrones spam.
    for (const f of FORBIDDEN_PATTERNS) {
      if (f.pattern.test(input.bodyText)) {
        issues.push({
          field: 'body',
          severity: 'warning',
          code: f.code,
          message: t(`templates.tplValidate_${f.code}`),
        });
        break;
      }
    }
  }

  // Footer
  if (input.footerText) {
    if (input.footerText.length > MAX_FOOTER) {
      issues.push({
        field: 'footer',
        severity: 'error',
        code: 'footer_too_long',
        message: t('templates.tplValidate_footer_too_long', {
          max: MAX_FOOTER,
          len: input.footerText.length,
        }),
      });
    }
    if (countVars(input.footerText) > 0) {
      issues.push({
        field: 'footer',
        severity: 'error',
        code: 'footer_no_vars',
        message: t('templates.tplValidate_footer_no_vars'),
      });
    }
  }

  // Buttons
  if (input.buttons.length > MAX_BUTTONS) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_buttons',
      message: t('templates.tplValidate_too_many_buttons', { max: MAX_BUTTONS }),
    });
  }
  const replyCount = input.buttons.filter((b) => b.type === 'QUICK_REPLY').length;
  const urlCount = input.buttons.filter((b) => b.type === 'URL').length;
  const phoneCount = input.buttons.filter((b) => b.type === 'PHONE_NUMBER').length;
  if (replyCount > MAX_QUICK_REPLY) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_reply',
      message: t('templates.tplValidate_too_many_reply', { max: MAX_QUICK_REPLY }),
    });
  }
  if (urlCount > MAX_URL_BUTTONS) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_url',
      message: t('templates.tplValidate_too_many_url', { max: MAX_URL_BUTTONS }),
    });
  }
  if (phoneCount > MAX_PHONE_BUTTONS) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_phone',
      message: t('templates.tplValidate_too_many_phone'),
    });
  }
  // Botones de respuesta no se pueden mezclar con CTA (url/phone).
  if (replyCount > 0 && urlCount + phoneCount > 0) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'mixed_buttons',
      message: t('templates.tplValidate_mixed_buttons'),
    });
  }
  input.buttons.forEach((b, i) => {
    if (!b.text?.trim()) {
      issues.push({
        field: `button.${i}`,
        severity: 'error',
        code: 'button_text_empty',
        message: t('templates.tplValidate_button_text_empty', { n: i + 1 }),
      });
    } else if (b.text.length > MAX_BUTTON_TEXT) {
      issues.push({
        field: `button.${i}`,
        severity: 'error',
        code: 'button_text_too_long',
        message: t('templates.tplValidate_button_text_too_long', {
          n: i + 1,
          max: MAX_BUTTON_TEXT,
        }),
      });
    }
    if (b.type === 'URL') {
      if (!b.url || !/^https:\/\//.test(b.url)) {
        issues.push({
          field: `button.${i}`,
          severity: 'error',
          code: 'button_url_https',
          message: t('templates.tplValidate_button_url_https', { n: i + 1 }),
        });
      }
    }
    if (b.type === 'PHONE_NUMBER') {
      if (!b.phone_number || !/^\+?\d{6,15}$/.test(b.phone_number)) {
        issues.push({
          field: `button.${i}`,
          severity: 'error',
          code: 'button_phone_format',
          message: t('templates.tplValidate_button_phone_format', { n: i + 1 }),
        });
      }
    }
  });

  // Reglas por categoría
  if (input.category === 'MARKETING' && input.buttons.length === 0) {
    issues.push({
      field: 'buttons',
      severity: 'warning',
      code: 'marketing_no_cta',
      message: t('templates.tplValidate_marketing_no_cta'),
    });
  }
  if (
    input.category === 'AUTHENTICATION' &&
    !/[0-9]{3,}/.test(input.bodyText)
  ) {
    issues.push({
      field: 'body',
      severity: 'warning',
      code: 'auth_no_code',
      message: t('templates.tplValidate_auth_no_code'),
    });
  }

  return issues;
}

function countVars(s: string): number {
  const m = s.match(/\{\{\d+\}\}/g);
  return m ? m.length : 0;
}
