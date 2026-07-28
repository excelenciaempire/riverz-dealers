import { NextResponse } from 'next/server';
import { adminGet, intParam, rangeFromSearch } from '@/lib/admin/route';
import { readLogs, isLogKind, LOG_KINDS } from '@/lib/admin/logs';

export const dynamic = 'force-dynamic';

/** Visor unificado de logs, una fuente por llamada. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'ai';
  if (!isLogKind(kind)) {
    return NextResponse.json(
      { error: 'unknown_kind', allowed: LOG_KINDS },
      { status: 400 },
    );
  }

  const { from, to } = rangeFromSearch(url);
  const workspaceId = url.searchParams.get('workspace') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const limit = intParam(url, 'limit', 100, 500);
  const offset = intParam(url, 'offset', 0, 100_000);

  return adminGet(
    request,
    { action: 'view.logs', meta: { kind, workspaceId: workspaceId ?? null, status: status ?? null } },
    async () => {
      const entries = await readLogs({
        kind,
        workspaceId,
        status,
        from,
        to,
        limit,
        offset,
      });
      return { entries, kind, hasMore: entries.length === limit };
    },
  );
}
