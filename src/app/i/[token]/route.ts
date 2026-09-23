import { NextResponse, type NextRequest } from 'next/server';
import { expandirConversationId } from '@/lib/avisos/enlace-conversacion';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const conversationId = expandirConversationId(token);
  if (!conversationId) return new NextResponse(null, { status: 404 });

  // Render entrega `request.url` con su origen interno (`localhost:10000`).
  // Un enlace público nunca debe filtrar ni redirigir hacia ese host.
  const publicOrigin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://riverz.co';
  const destination = new URL('/bandeja', publicOrigin);
  destination.searchParams.set('c', conversationId);
  return NextResponse.redirect(destination, 302);
}
