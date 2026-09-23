import { NextResponse, type NextRequest } from 'next/server';
import { expandirConversationId } from '@/lib/avisos/enlace-conversacion';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const conversationId = expandirConversationId(token);
  if (!conversationId) return new NextResponse(null, { status: 404 });

  const destination = new URL('/bandeja', request.url);
  destination.searchParams.set('c', conversationId);
  return NextResponse.redirect(destination, 302);
}
