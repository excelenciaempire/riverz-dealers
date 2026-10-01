import { readApi } from '@/lib/integrations/read-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return readApi(request, 'messages', (await context.params).id);
}
