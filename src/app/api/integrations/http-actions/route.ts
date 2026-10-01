import { httpActionApi } from '@/lib/integrations/http-action-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return httpActionApi(request, 'list'); }
export function POST(request: Request) { return httpActionApi(request, 'create'); }
