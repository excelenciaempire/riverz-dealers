import { httpActionApi } from '@/lib/integrations/http-action-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return httpActionApi(request, 'grants', (await context.params).id);
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return httpActionApi(request, 'grant-update', (await context.params).id);
}
