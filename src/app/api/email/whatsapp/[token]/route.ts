import { supabaseAdmin } from '@/lib/channels/admin-client';
import { whatsappPhone } from '@/lib/channels/email/whatsapp-referral';

export const dynamic = 'force-dynamic';
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!/^[a-f0-9]{24}$/.test(token)) return new Response(null, { status: 404 });
  const db = supabaseAdmin();
  const link = await db
    .from('email_whatsapp_links')
    .select('workspace_id,whatsapp_connection_id,prefill')
    .eq('token', token)
    .maybeSingle();
  if (link.error) return new Response(null, { status: 503 });
  if (!link.data) return new Response(null, { status: 404 });
  const connection = await db
    .from('channel_connections')
    .select('config')
    .eq('id', link.data.whatsapp_connection_id)
    .eq('workspace_id', link.data.workspace_id)
    .eq('channel', 'whatsapp')
    .eq('status', 'connected')
    .maybeSingle();
  const phone = whatsappPhone(connection.data?.config);
  if (connection.error || !phone) return new Response(null, { status: 503 });
  const destination = new URL(`https://wa.me/${phone}`);
  destination.searchParams.set('text', link.data.prefill);
  // Scanners can open email links: these are clicks, never customer inquiries.
  if (request.method === 'GET') {
    const counted = await db.rpc('count_email_whatsapp_click', {
      p_token: token,
    });
    if (counted.error)
      console.error('[email-whatsapp] click count failed:', counted.error.code);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination.toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
