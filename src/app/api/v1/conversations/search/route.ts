import { readApi } from '@/lib/integrations/read-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return readApi(request, 'conversationSearch'); }
