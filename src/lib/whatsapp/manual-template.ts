import { dynamicButtonTemplateUrl } from './dynamic-links';

export function dynamicUrlButtons(buttons: unknown) {
  return (Array.isArray(buttons) ? buttons : []).flatMap((button, index) => {
    if (!button || String(button.type).toUpperCase() !== 'URL' ||
        !/\{\{\s*\d+\s*\}\}/.test(button.url ?? '')) return [];
    return [{ index, text: String(button.text ?? ''), url: String(button.url) }];
  });
}

/** Full destination URLs are entered by the operator, never guessed from samples. */
export function manualButtonValue(templateUrl: string, input: unknown):
  { targetUrl: string } | { suffix: string } {
  if (typeof input !== 'string' || !input.trim()) throw new Error('inbox.templateLinkRequired');
  const value = input.trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('inbox.templateLinkInvalid'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('inbox.templateLinkInvalid');
  const base = templateUrl.replace(/\{\{\s*1\s*\}\}$/, '');
  const ownBase = dynamicButtonTemplateUrl().replace('{{1}}', '');
  if (base === ownBase) return { targetUrl: value };
  if (base === templateUrl || !value.startsWith(base) || value.length === base.length)
    throw new Error('inbox.templateLinkMismatch');
  return { suffix: value.slice(base.length) };
}

export function validBodyParams(text: string, params: unknown): params is string[] {
  const count = Math.max(0, ...Array.from(text.matchAll(/\{\{\s*(\d+)\s*\}\}/g), m => Number(m[1])));
  return Array.isArray(params) && params.length === count &&
    Array.from({ length: count }, (_, i) => params[i]).every(p => typeof p === 'string' && p.trim().length > 0);
}
