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
 * grano en español neutro) y `code` (para tracking).
 */

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
// Patrones que Meta rechaza típicamente.
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\$\$+|!!+|\?\?+/,
    message:
      'Evita signos repetidos (??, !!, $$). Meta los rechaza por considerarlos spam.',
  },
  {
    pattern: /[A-ZÁÉÍÓÚÑ]{6,}/u,
    message:
      'Evita palabras en mayúsculas largas. Meta lo lee como grito y suele rechazar.',
  },
];

export function validateTemplate(input: TemplateInput): TemplateIssue[] {
  const issues: TemplateIssue[] = [];

  // Nombre
  if (!input.name.trim()) {
    issues.push({
      field: 'name',
      severity: 'error',
      code: 'name_required',
      message: 'Escribe un nombre para la plantilla.',
    });
  } else {
    if (input.name.length > MAX_NAME) {
      issues.push({
        field: 'name',
        severity: 'error',
        code: 'name_too_long',
        message: `El nombre pasa de ${MAX_NAME} caracteres.`,
      });
    }
    if (!NAME_REGEX.test(input.name)) {
      issues.push({
        field: 'name',
        severity: 'error',
        code: 'name_format',
        message:
          'El nombre solo admite letras minúsculas, números y guion bajo (ej: confirmacion_pedido).',
      });
    }
  }

  // Idioma
  if (!input.language) {
    issues.push({
      field: 'language',
      severity: 'error',
      code: 'language_required',
      message: 'Elige el idioma de la plantilla.',
    });
  }

  // Header
  if (input.headerType === 'text') {
    if (!input.headerText?.trim()) {
      issues.push({
        field: 'header',
        severity: 'error',
        code: 'header_empty',
        message: 'El encabezado de texto está vacío.',
      });
    } else if (input.headerText.length > MAX_HEADER) {
      issues.push({
        field: 'header',
        severity: 'error',
        code: 'header_too_long',
        message: `El encabezado pasa de ${MAX_HEADER} caracteres (${input.headerText.length} actuales).`,
      });
    }
    // Solo se permite una variable en el header.
    const headerVars = countVars(input.headerText ?? '');
    if (headerVars > 1) {
      issues.push({
        field: 'header',
        severity: 'error',
        code: 'header_too_many_vars',
        message: 'El encabezado solo puede tener una variable.',
      });
    }
  }

  // Body
  if (!input.bodyText.trim()) {
    issues.push({
      field: 'body',
      severity: 'error',
      code: 'body_required',
      message: 'Escribe el texto del cuerpo de la plantilla.',
    });
  } else {
    if (input.bodyText.length > MAX_BODY) {
      issues.push({
        field: 'body',
        severity: 'error',
        code: 'body_too_long',
        message: `El cuerpo pasa de ${MAX_BODY} caracteres (${input.bodyText.length} actuales).`,
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
          message: `Falta un valor de ejemplo para {{${missing.join('}}, {{')}}}. Meta lo necesita para aprobar la plantilla.`,
        });
      }
    }
    // Espacios en blanco al inicio o final no permitidos.
    if (input.bodyText !== input.bodyText.trim()) {
      issues.push({
        field: 'body',
        severity: 'error',
        code: 'body_whitespace',
        message: 'El cuerpo no puede empezar ni terminar con espacios o saltos de línea.',
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
        message:
          'El cuerpo no puede empezar ni terminar con una variable. Agrega texto antes o después de {{1}}.',
      });
    }
    // Patrones spam.
    for (const f of FORBIDDEN_PATTERNS) {
      if (f.pattern.test(input.bodyText)) {
        issues.push({
          field: 'body',
          severity: 'warning',
          code: 'body_pattern',
          message: f.message,
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
        message: `El pie pasa de ${MAX_FOOTER} caracteres (${input.footerText.length} actuales).`,
      });
    }
    if (countVars(input.footerText) > 0) {
      issues.push({
        field: 'footer',
        severity: 'error',
        code: 'footer_no_vars',
        message: 'El pie de página no admite variables.',
      });
    }
  }

  // Buttons
  if (input.buttons.length > MAX_BUTTONS) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_buttons',
      message: `Meta acepta hasta ${MAX_BUTTONS} botones por plantilla.`,
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
      message: `Hasta ${MAX_QUICK_REPLY} botones de respuesta rápida.`,
    });
  }
  if (urlCount > MAX_URL_BUTTONS) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_url',
      message: `Hasta ${MAX_URL_BUTTONS} botones con URL.`,
    });
  }
  if (phoneCount > MAX_PHONE_BUTTONS) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'too_many_phone',
      message: 'Solo se permite un botón de llamada.',
    });
  }
  // Botones de respuesta no se pueden mezclar con CTA (url/phone).
  if (replyCount > 0 && urlCount + phoneCount > 0) {
    issues.push({
      field: 'buttons',
      severity: 'error',
      code: 'mixed_buttons',
      message:
        'No puedes mezclar botones de respuesta rápida con botones de URL o teléfono. Elige una sola modalidad.',
    });
  }
  input.buttons.forEach((b, i) => {
    if (!b.text?.trim()) {
      issues.push({
        field: `button.${i}`,
        severity: 'error',
        code: 'button_text_empty',
        message: `El botón ${i + 1} no tiene texto.`,
      });
    } else if (b.text.length > MAX_BUTTON_TEXT) {
      issues.push({
        field: `button.${i}`,
        severity: 'error',
        code: 'button_text_too_long',
        message: `El texto del botón ${i + 1} pasa de ${MAX_BUTTON_TEXT} caracteres.`,
      });
    }
    if (b.type === 'URL') {
      if (!b.url || !/^https:\/\//.test(b.url)) {
        issues.push({
          field: `button.${i}`,
          severity: 'error',
          code: 'button_url_https',
          message: `El botón ${i + 1} debe usar una URL con https://.`,
        });
      }
    }
    if (b.type === 'PHONE_NUMBER') {
      if (!b.phone_number || !/^\+?\d{6,15}$/.test(b.phone_number)) {
        issues.push({
          field: `button.${i}`,
          severity: 'error',
          code: 'button_phone_format',
          message: `El teléfono del botón ${i + 1} debe estar en formato internacional (ej: +573001234567).`,
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
      message:
        'Las plantillas de Marketing convierten mucho mejor con al menos un botón. Considera agregar uno.',
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
      message:
        'Las plantillas de Autenticación suelen incluir el código OTP en el cuerpo. ¿Olvidaste la variable?',
    });
  }

  return issues;
}

function countVars(s: string): number {
  const m = s.match(/\{\{\d+\}\}/g);
  return m ? m.length : 0;
}
