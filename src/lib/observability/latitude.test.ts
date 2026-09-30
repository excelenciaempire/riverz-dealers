import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  capture: vi.fn(),
  ready: Promise.resolve(),
  failStart: false,
  span: {
    spanContext: () => ({ traceId: 'trace-test' }),
    setStatus: vi.fn(),
    setAttributes: vi.fn(),
    setAttribute: vi.fn(),
    end: vi.fn(),
  },
}));
vi.mock('@latitude-data/telemetry', () => ({
  Latitude: class {
    ready = harness.ready;
    getTracer() {
      return {
        startActiveSpan: (
          _name: string,
          work: (span: typeof harness.span) => unknown
        ) => {
          if (harness.failStart) throw new Error('telemetry setup failed');
          return work(harness.span);
        },
      };
    }
  },
  capture: harness.capture,
}));
vi.mock('@latitude-data/telemetry/instrumentations/anthropic', () => ({
  createAnthropicInstrumentation: () => ({}),
}));
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {},
}));

beforeEach(() => {
  Reflect.deleteProperty(globalThis, '__riverzLatitudeTracing');
  vi.resetModules();
  vi.stubEnv('LATITUDE_API_KEY', 'test-latitude-key');
  vi.stubEnv('LATITUDE_PROJECT_SLUG', 'riverz-test');
  vi.stubEnv('LATITUDE_TRACING_ENABLED', 'true');
  harness.ready = Promise.resolve();
  harness.failStart = false;
  harness.span.setAttributes.mockReset();
  harness.capture.mockImplementation((_name, work) => work());
});
afterEach(() => vi.unstubAllEnvs());

describe('telemetry cannot repeat business actions', () => {
  it('runs normally when disabled or configuration is absent', async () => {
    vi.stubEnv('LATITUDE_TRACING_ENABLED', 'false');
    const { withLatitudeTrace } = await import('./latitude');
    const work = vi.fn().mockResolvedValue('sent');
    expect(await withLatitudeTrace('turn', { workspaceId: 'w' }, work)).toBe(
      'sent'
    );
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('does not retry successful work if capture cleanup throws', async () => {
    harness.capture.mockImplementation(async (_name, work) => {
      await work();
      throw new Error('export failed');
    });
    const { withLatitudeTrace } = await import('./latitude');
    const work = vi.fn().mockResolvedValue('order-created');
    expect(await withLatitudeTrace('turn', { workspaceId: 'w' }, work)).toBe(
      'order-created'
    );
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('preserves the original business error without running work again', async () => {
    const { withLatitudeTrace } = await import('./latitude');
    const error = new Error('order_failed');
    const work = vi.fn().mockRejectedValue(error);
    await expect(
      withLatitudeTrace('turn', { workspaceId: 'w' }, work)
    ).rejects.toBe(error);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('does not turn a completed action into a failure when result annotations throw', async () => {
    harness.span.setAttributes
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('annotation failed');
      });
    const { withLatitudeTrace } = await import('./latitude');
    const work = vi.fn().mockResolvedValue('sent');
    expect(
      await withLatitudeTrace('turn', { workspaceId: 'w' }, work, {
        resultAttributes: () => ({ result: 'ok' }),
      })
    ).toBe('sent');
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('falls back once if telemetry fails before invoking work', async () => {
    harness.failStart = true;
    const { withLatitudeTrace } = await import('./latitude');
    const work = vi.fn().mockResolvedValue('sent');
    expect(await withLatitudeTrace('turn', { workspaceId: 'w' }, work)).toBe(
      'sent'
    );
    expect(work).toHaveBeenCalledTimes(1);
  });
  it('sanitizes attributes, events and error status in a copy before export', async () => {
    const { privateLatitudeSpan } = await import('./latitude');
    const span = {
      spanContext: () => ({ traceId: 'private' }),
      name: 'chat',
      attributes: {
        'gen_ai.usage.input_tokens': 12,
        'gen_ai.input.messages': 'email: test@example.com',
        authorization: 'secret',
      },
      events: [
        {
          name: 'exception',
          attributes: { 'exception.message': 'test@example.com' },
        },
      ],
      links: [],
      status: { code: 2, message: 'test@example.com' },
      resource: { attributes: { 'service.name': 'riverz-crm' } },
    };
    const copy = privateLatitudeSpan(
      span as unknown as Parameters<typeof privateLatitudeSpan>[0]
    );
    expect(copy.attributes['gen_ai.usage.input_tokens']).toBe(12);
    expect(JSON.stringify(copy)).not.toContain('test@example.com');
    expect(copy.attributes.authorization).toBe('[REDACTED]');
    expect(span.status.message).toBe('test@example.com');
  });
});
