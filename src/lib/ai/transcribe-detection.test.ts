import { beforeEach,afterEach,describe,expect,it,vi } from 'vitest'
const m=vi.hoisted(() => ({ reserve:vi.fn(),settle:vi.fn(),cancel:vi.fn(),metadata:vi.fn() }))
vi.mock('@/lib/wallet/operacion',() => ({ reservar:m.reserve,liquidar:m.settle,cancelar:m.cancel }))
vi.mock('@/lib/admin/provider-credit',() => ({ observePlatformCredit:async () => {} }))
vi.mock('music-metadata',() => ({ parseBuffer:m.metadata }))
import { transcribeBuffer } from './transcribe'
const billing={ db:{} as never,workspaceId:'workspace',concepto:'transcripcion' }
beforeEach(() => { vi.stubEnv('GROQ_API_KEY','synthetic');m.reserve.mockReset().mockResolvedValue('op');m.settle.mockReset().mockResolvedValue(null);m.cancel.mockReset();m.metadata.mockResolvedValue({ format:{ duration:15 } });vi.stubGlobal('fetch',vi.fn().mockImplementation(async () => Response.json({ text:'An English audio.',duration:15,language:'en' }))) })
afterEach(() => { vi.unstubAllGlobals();vi.unstubAllEnvs() })
describe('opt-in transcription language detection',() => {
  it('detects language for the new inbox request and keeps existing callers unchanged',async () => {
    expect((await transcribeBuffer(Buffer.from('audio'),{ billing,detectLanguage:true }))?.language).toBe('en')
    let form=(vi.mocked(fetch).mock.calls[0][1]?.body as FormData);expect(form.has('language')).toBe(false)
    await transcribeBuffer(Buffer.from('audio'),{ billing });form=vi.mocked(fetch).mock.calls[1][1]?.body as FormData;expect(form.get('language')).toBe('es')
    expect(m.reserve).toHaveBeenCalledTimes(2);expect(m.settle).toHaveBeenCalledTimes(2)
  })
})
