import { describe, it, expect, vi } from 'vitest';
import { hasResolutionEvidence, isSimpleClosure, reconcileHumanAttention, type AttentionMessage } from './reconcile-human-attention';

const at = '2026-09-20T17:27:41Z';
function message(patch: Partial<AttentionMessage> = {}): AttentionMessage {
  return { id: 'answer', created_at: '2026-09-20T17:30:37Z', sender_type: 'agent', status: 'read', content_text: 'Pedido confirmado.', ...patch };
}
const closure = message({ id: 'thanks', created_at: '2026-09-22T15:50:41Z', sender_type: 'customer', content_text: 'Gracias' });
describe('resolution evidence', () => {
  it('resolves Musa: manual confirmation, automated tracking, customer thanks', () => {
    expect(hasResolutionEvidence(at, [closure, message({ id: 'tracking', created_at: '2026-09-22T15:49:27Z', origin: 'automation', sender_type: 'bot' }), message()])).toBe(true);
  });
  it.each(['Gracias pero no llegó', 'Ok, quiero devolución', 'Gracias. ¿Cuándo llega?', '👍 quiero hablar con alguien'])('keeps a new request: %s', content_text => {
    expect(isSimpleClosure(content_text)).toBe(false);
    expect(hasResolutionEvidence(at, [message({ ...closure, content_text }), message()])).toBe(false);
  });
  it.each(['Genial muchas gracias.', 'Excelente!', 'OK gracias', 'Thanks!', '👍'])('recognizes bounded closures: %s', text => expect(isSimpleClosure(text)).toBe(true));
  it('does not resolve a handoff just because the customer says thanks', () => {
    expect(hasResolutionEvidence(at, [closure, message({ sender_type: 'bot', origin: 'ai_agent', content_text: 'Ya paso esto a una persona del equipo.' })])).toBe(false);
  });
  it('resolves a completed AI answer followed by thanks', () => {
    expect(hasResolutionEvidence(at, [closure, message({ sender_type: 'bot', origin: 'ai_agent', content_text: 'Tu pedido ya figura pagado, quedó todo en orden.' })])).toBe(true);
  });
  it('does not mistake a legacy mirrored comment DM for a human response', () => {
    expect(hasResolutionEvidence(at, [message({ content_text: 'Vi tu comentario: Hola, quiero el cambio. Te escribo por privado.' })])).toBe(false);
  });
  it('does not clear a complaint after a sales pitch and thanks', () => {
    expect(hasResolutionEvidence(at, [closure, message({ sender_type: 'bot', origin: 'ai_agent', content_text: 'Tenemos varios productos. ¿Cuál quieres?' })])).toBe(false);
  });
  it('does not resolve an automation alone or an unanswered request between reply and thanks', () => {
    expect(hasResolutionEvidence(at, [closure, message({ origin: 'automation', sender_type: 'bot' })])).toBe(false);
    expect(hasResolutionEvidence(at, [closure, message({ sender_type: 'customer', created_at: '2026-09-21T00:00:00Z', content_text: 'No llegó' }), message()])).toBe(false);
  });
  it.each([{ status: 'failed' }, { status: 'sending' }, { status: 'sent', held_for_quality: true }, { deleted_at: at }])('does not count unsent/deleted replies: %j', patch => {
    expect(hasResolutionEvidence(at, [closure, message(patch)])).toBe(false);
  });
  it('never resolves a newer escalation with older evidence', () => {
    expect(hasResolutionEvidence('2026-09-22T16:00:00Z', [closure, message()])).toBe(false);
  });
});

function database({ changed = false, inserted = false, error = false } = {}) {
  const snapshot = { id: 'case', needs_human_reason: 'problema_detectado', needs_human_at: at, last_message_at: '2026-09-22T15:50:41.025Z', updated_at: '2026-09-22T15:50:41.030Z' };
  const update = vi.fn(); const eq = vi.fn();
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'is', 'neq', 'order', 'limit', 'eq', 'update']) q[name] = vi.fn((...args: unknown[]) => { if (name === 'update') update(...args); if (name === 'eq') eq(...args); return q; });
    q.maybeSingle = vi.fn(async () => result);
    q.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return q;
  };
  const db = { from: vi.fn()
    .mockReturnValueOnce(chain({ data: snapshot, error: null }))
    .mockReturnValueOnce(chain({ data: [closure, message()], error: null }))
    .mockReturnValueOnce(chain({ data: { id: inserted ? 'new-request' : closure.id }, error: null }))
    .mockReturnValueOnce(chain({ data: changed ? [] : [{ id: 'case' }], error: error ? { code: 'timeout' } : null })) };
  return { db, update, eq, snapshot };
}
describe('atomic reconciliation', () => {
  it('handles millisecond drift using exact revision guards, without toggling AI', async () => {
    const { db, update, eq, snapshot } = database();
    expect(await reconcileHumanAttention(db as never, 'case')).toBe(true);
    expect(eq).toHaveBeenCalledWith('updated_at', snapshot.updated_at);
    expect(eq).toHaveBeenCalledWith('needs_human_at', at);
    expect(eq).toHaveBeenCalledWith('last_message_at', snapshot.last_message_at);
    expect(update.mock.calls[0][0]).not.toHaveProperty('ai_enabled');
    expect(update.mock.calls[0][0]).not.toHaveProperty('status');
  });
  it('keeps a new inbound inserted before the conversation snapshot updates', async () => {
    const { db, update } = database({ inserted: true });
    expect(await reconcileHumanAttention(db as never, 'case')).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it.each([{ changed: true }, { error: true }])('fails closed on a concurrent update or database failure: %j', async options => {
    expect(await reconcileHumanAttention(database(options).db as never, 'case')).toBe(false);
  });
});
