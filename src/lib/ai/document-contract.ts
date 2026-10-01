export const DOCUMENT_FORMATS = ['pdf', 'docx', 'xlsx'] as const;
export type DocumentFormat = typeof DOCUMENT_FORMATS[number];
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_TEXT = 32000;
export const DOCUMENT_TOTAL_TEXT = 48000;
export type DocumentStatus = 'draft' | 'active' | 'withdrawn';
export interface DocumentSource {
  id: string;
  name: string;
  format: DocumentFormat;
  bytes: number;
  sha256: string;
  text: string;
  status: DocumentStatus;
  revision: number;
  updated_at: string;
}
export interface DocumentRevision {
  revision: number;
  name: string;
  status: DocumentStatus;
  sha256: string;
  observed_at: string;
}
export const DOCUMENT_FAILURES = ['document_too_large', 'document_no_text', 'document_text_limit', 'document_formulas', 'document_unreadable', 'document_invalid', 'document_changed', 'document_admin_required', 'document_limit', 'document_unavailable', 'document_busy', 'invalid_document_context', 'subscription_read_only'] as const;
export type DocumentFailure = typeof DOCUMENT_FAILURES[number];
export function isDocumentSource(value: unknown): value is DocumentSource {
  if (!value || typeof value !== 'object') return false;
  const row = value as DocumentSource;
  return typeof row.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)
    && typeof row.name === 'string' && row.name.length > 0 && row.name.length <= 160
    && DOCUMENT_FORMATS.includes(row.format) && Number.isInteger(row.bytes) && row.bytes > 0 && row.bytes <= DOCUMENT_MAX_BYTES
    && typeof row.sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.sha256)
    && typeof row.text === 'string' && row.text.trim().length > 0 && row.text.length <= DOCUMENT_MAX_TEXT
    && ['draft', 'active', 'withdrawn'].includes(row.status) && Number.isSafeInteger(row.revision) && row.revision > 0
    && typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at));
}
