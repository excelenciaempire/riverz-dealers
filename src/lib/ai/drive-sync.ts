import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { decrypt, encrypt } from '@/lib/channels/encryption';
import { driveFileId, driveToken, downloadDriveDocument, DriveProviderError, refreshDriveToken } from './drive-provider';
import { DocumentExtractionError, extractDocument } from './document-extraction';
import { DOCUMENT_FAILURES } from './document-contract';

const jobSchema = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), agent_id: z.string().uuid(),
  actor_id: z.string().uuid(), file_id: driveFileId, connection_revision: z.number().int().positive(),
  state: z.literal('processing'), lease_id: z.string().uuid(), credential_ciphertext: z.string().min(10).max(65536) });
function errorCode(error: unknown) {
  if (error instanceof DriveProviderError || error instanceof DocumentExtractionError) return error.code;
  if (error && typeof error === 'object' && 'message' in error
    && DOCUMENT_FAILURES.includes(error.message as typeof DOCUMENT_FAILURES[number])) {
    return ['document_admin_required','invalid_document_context','document_unavailable'].includes(error.message as string)
      ? 'drive_unavailable' : error.message as string;
  }
  return 'drive_unavailable';
}
/** Read-only provider work can be leased again after a crash. Publication always checks the current lease. */
export async function syncDriveDocuments(db: SupabaseClient) {
  const result = { imported: 0, superseded: 0, failed: 0 };
  if (!SHOW_RIVERZ_IMPROVEMENTS) return result;
  const claimed = await db.rpc('claim_ai_drive_sources', { p_limit: 6 });
  if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length > 6) throw new Error('drive_sync_unavailable');
  const jobs = z.array(jobSchema).max(6).safeParse(claimed.data);
  if (!jobs.success) throw new Error('drive_sync_unavailable');
  // Two isolated parsers at most, shared with the manual import limit.
  for (let index = 0; index < jobs.data.length; index += 2) {
    await Promise.all(jobs.data.slice(index, index + 2).map(async job => {
      try {
        const original = driveToken.parse(JSON.parse(decrypt(job.credential_ciphertext)));
        const token = await refreshDriveToken(original);
        if (token !== original && (token.access_token !== original.access_token || token.refresh_token !== original.refresh_token)) {
          const saved = await db.rpc('update_ai_drive_credentials', { p_id: job.id, p_lease_id: job.lease_id,
            p_connection_revision: job.connection_revision, p_previous: job.credential_ciphertext, p_next: encrypt(JSON.stringify(token)) });
          if (saved.error || saved.data !== true) throw new DriveProviderError('drive_changed');
        }
        const downloaded = await downloadDriveDocument(token, job.file_id);
        const document = await extractDocument(downloaded.file);
        const finished = await db.rpc('finish_ai_drive_source', { p_id: job.id, p_lease_id: job.lease_id,
          p_connection_revision: job.connection_revision, p_document: document, p_remote_version: downloaded.remoteVersion, p_modified_at: downloaded.modifiedAt });
        if (finished.error) throw finished.error;
        if (finished.data === true) result.imported++;
        else result.superseded++;
      } catch (error) {
        try {
          const failed = await db.rpc('fail_ai_drive_source', { p_id: job.id, p_lease_id: job.lease_id, p_error_code: errorCode(error) });
          if (failed.error) console.error('[ai] Drive sync failure receipt unavailable');
        } catch { console.error('[ai] Drive sync failure receipt unavailable'); }
        result.failed++;
      }
    }));
  }
  return result;
}
