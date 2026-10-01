import { httpActionApi } from '@/lib/integrations/http-action-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return httpActionApi(request, 'update', (await context.params).id);
}
