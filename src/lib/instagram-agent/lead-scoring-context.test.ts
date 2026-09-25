import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scoreLeads } from './lead-scoring';
import { hayJev, preguntarJev } from '@/lib/ai/jev';
import { completeText } from '@/lib/ai/llm-client';
import { puedeUsarIa } from '@/lib/wallet/puerta';

vi.mock('@/lib/ai/jev', () => ({ hayJev: vi.fn(), preguntarJev: vi.fn() }));
vi.mock('@/lib/ai/llm-client', () => ({ hasLlm: () => true, completeText: vi.fn() }));
vi.mock('@/lib/wallet/puerta', () => ({ puedeUsarIa: vi.fn(async () => true) }));
const billing = { db: {}, workspaceId: 'workspace', concepto: 'ia_clasificacion' } as never;
const comment = 'No dice cuánto vale entonces cuál es negocio';
const post = 'Puma Suede XL: el segundo par gratis';
beforeEach(() => vi.clearAllMocks());

describe('publication context in comment classification', () => {
  it('passes publication context separately from customer messages to Jev', async () => {
    vi.mocked(hayJev).mockReturnValue(true);
    vi.mocked(preguntarJev).mockResolvedValue({ answers: {} } as never);
    await scoreLeads('key', [comment], billing, post);
    expect(preguntarJev).toHaveBeenCalledWith(expect.objectContaining({
      state: { publicacion: post, mensajes: [comment] },
    }));
    expect(completeText).not.toHaveBeenCalled();
  });

  it('does not classify when the account cannot use AI', async () => {
    vi.mocked(puedeUsarIa).mockResolvedValueOnce(false);
    vi.mocked(hayJev).mockReturnValue(true);
    await expect(scoreLeads('key', [comment], billing, post)).rejects.toThrow('sin_ia');
    expect(preguntarJev).not.toHaveBeenCalled();
    expect(completeText).not.toHaveBeenCalled();
  });

  it('preserves publication context when Jev falls back to the language model', async () => {
    vi.mocked(hayJev).mockReturnValue(true);
    vi.mocked(preguntarJev).mockResolvedValue(null);
    vi.mocked(completeText).mockResolvedValue('[{"i":0,"score":"high","sentiment":"neutral","spam":false}]');
    const [lead] = await scoreLeads('key', [comment], billing, post);
    expect(completeText).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining(post),
    }));
    expect(completeText).toHaveBeenCalledWith(expect.objectContaining({
      user: expect.stringContaining(`0: ${comment}`),
    }));
    expect(lead).toEqual({ score: 'high', sentiment: 'neutral', spam: false });
  });
});
