import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DOCUMENT_FAILURES, DOCUMENT_FORMATS, DOCUMENT_MAX_BYTES, DOCUMENT_MAX_TEXT, type DocumentFailure, type DocumentFormat } from './document-contract';

const MIME: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
let activeParsers = 0;
export class DocumentExtractionError extends Error {
  constructor(public readonly code: DocumentFailure) { super(code); }
}
export async function extractDocument(file: File): Promise<{ name: string;format: DocumentFormat;bytes: number;sha256: string;text: string }> {
  const format = file.name.split('.').pop()?.toLowerCase() as DocumentFormat;
  if (!DOCUMENT_FORMATS.includes(format) || !file.name || file.name.length > 160 || /[\x00-\x1f\\/]/.test(file.name)
    || (file.type && file.type !== MIME[format] && file.type !== 'application/octet-stream')) throw new DocumentExtractionError('document_invalid');
  if (!file.size || file.size > DOCUMENT_MAX_BYTES) throw new DocumentExtractionError('document_too_large');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (activeParsers >= 2) throw new DocumentExtractionError('document_busy');
  activeParsers++;
  let response: string;
  try { response = await new Promise<string>((accept, reject) => {
    const child = execFile(process.execPath, ['--max-old-space-size=192', resolve(process.cwd(), 'scripts/extract-ai-document.mjs')], {
      timeout: 20_000, maxBuffer: 512_000, windowsHide: true, env: { NODE_ENV: 'production' },
    }, (error, stdout) => error ? reject(new DocumentExtractionError('document_unreadable')) : accept(stdout));
    child.stdin?.on('error', () => { /* An early worker exit is handled by execFile. */ });
    child.stdin?.end(JSON.stringify({ format, data: bytes.toString('base64') }));
  }); } finally { activeParsers--; }
  let result: { ok?: boolean;text?: string;code?: DocumentFailure };
  try { result = JSON.parse(response); } catch { throw new DocumentExtractionError('document_unreadable'); }
  if (!result.ok || typeof result.text !== 'string' || !result.text.trim() || result.text.length > DOCUMENT_MAX_TEXT) {
    throw new DocumentExtractionError(DOCUMENT_FAILURES.includes(result.code!) ? result.code! : 'document_unreadable');
  }
  return { name: file.name, format, bytes: file.size, sha256: createHash('sha256').update(bytes).digest('hex'), text: result.text };
}
