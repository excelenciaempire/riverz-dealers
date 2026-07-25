import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { csrfGuard } from '@/lib/csrf';
import { serverError } from '@/lib/api/errors';
import { uploadDocument } from '@/lib/voice/telnyx-numbers';

/**
 * POST /api/voice/numbers/documents   (multipart: file, workspace_id)
 * Upload a regulatory document to Telnyx → returns its document id, to be used
 * as a requirement's field_value. Admin-only (part of the paid provisioning
 * flow). Telnyx deletes unlinked documents after ~30 min.
 */
const MAX_BYTES = 12 * 1024 * 1024;

async function isAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  return Boolean(data);
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 });
  }
  const workspaceId = String(form.get('workspace_id') || '');
  const file = form.get('file');
  if (!workspaceId || !(file instanceof File)) {
    return NextResponse.json({ error: 'workspace_id and file required' }, { status: 400 });
  }
  if (!(await isAdmin(user.id, workspaceId)))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large' }, { status: 413 });
  }

  try {
    const b64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const doc = await uploadDocument({
      base64: b64,
      filename: file.name || 'document',
      customerReference: workspaceId,
    });
    return NextResponse.json({ document_id: doc.id, status: doc.status });
  } catch (err) {
    return serverError(err, 'document upload failed');
  }
}
