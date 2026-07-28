import { adminGet, rangeFromSearch } from '@/lib/admin/route';
import { getPlatformOverview, getActivitySeries } from '@/lib/admin/queries';

export const dynamic = 'force-dynamic';

/** Resumen de plataforma + serie diaria para las sparklines de /admin. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const { from, to } = rangeFromSearch(url);

  return adminGet(
    request,
    { action: 'view.overview', meta: { from: from.toISOString(), to: to.toISOString() } },
    async () => {
      const [overview, series] = await Promise.all([
        getPlatformOverview(from, to),
        getActivitySeries(from, to),
      ]);
      return { overview, series, from: from.toISOString(), to: to.toISOString() };
    },
  );
}
