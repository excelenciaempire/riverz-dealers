import { htmlToText } from '../html-to-text';

/** Plain text only: never render email markup in the conversation list. */
export function emailPreview(channel: string, value: string | null | undefined): string {
  const text = value ?? '';
  return ['gmail', 'outlook', 'zoho'].includes(channel)
    ? htmlToText(text).replace(/\s+/g, ' ').trim()
    : text;
}
