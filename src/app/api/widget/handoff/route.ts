import { NextResponse } from 'next/server';

/**
 * El webchat es autónomo: la IA atiende el hilo completo. Se conserva la ruta
 * durante la transición para que una versión anterior del widget no pueda
 * convertir una conversación en atención humana.
 */
export async function POST() {
  return NextResponse.json({ error: 'webchat_ai_only' }, { status: 410 });
}
