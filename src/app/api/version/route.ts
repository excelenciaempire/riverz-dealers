import { NextResponse } from 'next/server'

// Endpoint público de diagnóstico: confirma qué build está sirviendo Render
// (marker + commit). Útil para verificar que un deploy realmente subió.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    marker: 'errcap-v2',
    commit: process.env.RENDER_GIT_COMMIT ?? null,
    ts: new Date().toISOString(),
  })
}
