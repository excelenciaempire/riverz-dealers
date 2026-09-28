import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendOutlookDraft } from './adapter';

describe('sendOutlookDraft', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('envía una sola vez y deja que Enviados aporte el id definitivo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendOutlookDraft('token', 'draft-id')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.microsoft.com/v1.0/me/messages/draft-id/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
