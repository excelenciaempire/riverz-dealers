import { httpActionApi } from '@/lib/integrations/http-action-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return httpActionApi(request, 'history', (await context.params).id);
}
