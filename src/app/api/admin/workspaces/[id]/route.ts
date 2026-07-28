import { NextResponse } from 'next/server';
import { adminGet } from '@/lib/admin/route';
import { getWorkspaceDetail } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/** Ficha de un comercio. Solo lectura y solo metadatos. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  return adminGet(
    request,
    { action: 'view.workspace', targetType: 'workspace', targetId: id },
    async () => {
      const detail = await getWorkspaceDetail(id);
      if (!detail) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      return detail;
    },
  );
}
