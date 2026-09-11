import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { resolverWabaYToken } from '@/lib/templates/create';
import { TEMPLATE_HEADER_MIME, uploadTemplateHeaderMedia } from '@/lib/whatsapp/template-media';

const MAX_BYTES = 16 * 1024 * 1024;

export async function POST(request: Request) {
  const blocked = await csrfGuard(request);
  if (blocked) return blocked;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const type = String(form?.get('type') ?? '');
  if (!(file instanceof File) || !['image', 'video', 'document'].includes(type)) {
    return NextResponse.json({ error: 'invalid_file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES || !TEMPLATE_HEADER_MIME[type as 'image' | 'video' | 'document'].includes(file.type)) {
    return NextResponse.json({ error: 'unsupported_file' }, { status: 400 });
  }
  const workspaceId = await resolveWorkspaceIdForUser(supabase, user.id);
  if (!workspaceId || !process.env.META_APP_ID) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const { accessToken } = await resolverWabaYToken(supabase, workspaceId, user.id);
  if (!accessToken) return NextResponse.json({ error: 'not_connected' }, { status: 400 });
  try {
    const handle = await uploadTemplateHeaderMedia({ appId: process.env.META_APP_ID, accessToken, file });
    return NextResponse.json({ handle, name: file.name });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'upload_failed' }, { status: 502 });
  }
}
