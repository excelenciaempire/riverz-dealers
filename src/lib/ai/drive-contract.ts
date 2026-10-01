import { z } from 'zod';
import { DOCUMENT_FAILURES } from './document-contract';
export const driveSourceState = z.enum(['queued','processing','ready','failed','denied']);
export const driveSourceList = z.object({ connected: z.boolean(), email: z.string().email().nullable(), sources: z.array(z.object({
  id: z.string().uuid(), file_id: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/), source_id: z.string().uuid().nullable(),
  name: z.string().max(160).nullable(), revision: z.number().int().positive(), state: driveSourceState,
  synced_at: z.string().datetime({ offset: true }).nullable(), remote_modified_at: z.string().datetime({ offset: true }).nullable(),
  error_code: z.enum([...DOCUMENT_FAILURES,'drive_denied','drive_unavailable','drive_changed','drive_unsupported']).nullable(),
}).strict()).max(20) }).strict();
export type DriveSourceList = z.infer<typeof driveSourceList>;
