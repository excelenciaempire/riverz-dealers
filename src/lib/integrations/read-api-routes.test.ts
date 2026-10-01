import { beforeEach, expect, it, vi } from 'vitest';
const gateway = vi.hoisted(() => vi.fn());
vi.mock('@/lib/integrations/read-api', () => ({ readApi: gateway }));
import { GET as search } from '@/app/api/v1/conversations/search/route';
import { GET as detail } from '@/app/api/v1/conversations/[id]/route';
import { GET as messages } from '@/app/api/v1/conversations/[id]/messages/route';
import { GET as contacts } from '@/app/api/v1/contacts/search/route';
import { GET as cases } from '@/app/api/v1/reports/cases/route';
const request = new Request('https://riverz.test/api/v1/example');
beforeEach(() => { gateway.mockReset(); gateway.mockResolvedValue(new Response('{}')); });
it.each([[search, 'conversationSearch'], [contacts, 'contactSearch'], [cases, 'caseReport']] as const)(
  'routes the fixed resource %s to %s', async (handler, resource) => {
    await handler(request); expect(gateway).toHaveBeenCalledWith(request, resource);
  });
it.each([[detail, 'conversation'], [messages, 'messages']] as const)(
  'awaits route params and uses the fixed resource %s to %s', async (handler, resource) => {
    await handler(request, { params: Promise.resolve({ id: 'record-id' }) });
    expect(gateway).toHaveBeenCalledWith(request, resource, 'record-id');
  });
