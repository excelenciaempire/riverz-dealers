import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Latitude,
  capture,
  type LatitudeOptions,
} from '@latitude-data/telemetry';
import { createAnthropicInstrumentation } from '@latitude-data/telemetry/instrumentations/anthropic';
import * as AnthropicSDK from '@anthropic-ai/sdk';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  latitudeId,
  scrubLatitudeText,
  scrubLatitudeValue,
} from './latitude-privacy';

type Exporter = NonNullable<LatitudeOptions['exporter']>;
type ExportedSpan = Parameters<Exporter['export']>[0][number];
export interface LatitudeContext {
  workspaceId: string;
  sessionId?: string | null;
  userId?: string | null;
  channel?: string;
  agentId?: string | null;
  privateValues?: readonly (string | null | undefined)[];
}
type LatitudeState = {
  turn: AsyncLocalStorage<LatitudeContext>;
  sensitiveByTrace: Map<string, { values: string[]; expires: number }>;
  instance: Latitude | null;
  starting: Promise<Latitude | null> | null;
};
// Next creates separate server bundles; all must share one provider/processor.
const globalState = globalThis as typeof globalThis & {
  __riverzLatitudeTracing?: LatitudeState;
};
const state = (globalState.__riverzLatitudeTracing ??= {
  turn: new AsyncLocalStorage<LatitudeContext>(),
  sensitiveByTrace: new Map(),
  instance: null,
  starting: null,
});
const { turn, sensitiveByTrace } = state;

function rememberPrivateValues(
  traceId: string,
  values: LatitudeContext['privateValues']
) {
  const now = Date.now();
  for (const [id, entry] of sensitiveByTrace)
    if (entry.expires < now) sensitiveByTrace.delete(id);
  // Bounded state for delayed batch export; long streams get 30 minutes.
  if (sensitiveByTrace.size >= 1000)
    sensitiveByTrace.delete(sensitiveByTrace.keys().next().value!);
  const existing = sensitiveByTrace.get(traceId)?.values ?? [];
  sensitiveByTrace.set(traceId, {
    values: [
      ...new Set([
        ...existing,
        ...(values ?? []).filter((v): v is string => Boolean(v)),
      ]),
    ].slice(0, 100),
    expires: now + 30 * 60_000,
  });
}

/** Sanitize a copy immediately before export, including error events/status. */
export function privateLatitudeSpan(span: ExportedSpan): ExportedSpan {
  const values = sensitiveByTrace.get(span.spanContext().traceId)?.values ?? [];
  const attrs = (attributes: ExportedSpan['attributes']) =>
    Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [
        key,
        /authorization|cookie|secret|api.?key|token|password/i.test(key) &&
        !/tokens|token_count/i.test(key)
          ? '[REDACTED]'
          : scrubLatitudeValue(value, values),
      ])
    ) as ExportedSpan['attributes'];
  return {
    ...span,
    spanContext: () => span.spanContext(),
    name: scrubLatitudeText(span.name, values),
    attributes: attrs(span.attributes),
    events: span.events.map((event) => ({
      ...event,
      name: scrubLatitudeText(event.name, values),
      attributes: event.attributes ? attrs(event.attributes) : undefined,
    })),
    links: span.links.map((link) => ({
      ...link,
      attributes: link.attributes ? attrs(link.attributes) : undefined,
    })),
    status: {
      ...span.status,
      message: span.status.message
        ? scrubLatitudeText(span.status.message, values)
        : undefined,
    },
    resource: {
      ...span.resource,
      attributes: attrs(span.resource.attributes),
    } as ExportedSpan['resource'],
  };
}

export async function initLatitudeTracing(): Promise<Latitude | null> {
  if (
    process.env.LATITUDE_TRACING_ENABLED === 'false' ||
    !process.env.LATITUDE_API_KEY ||
    !process.env.LATITUDE_PROJECT_SLUG
  )
    return null;
  if (state.starting) return state.starting;
  state.starting = (async () => {
    try {
      const exporter = new OTLPTraceExporter({
        url: 'https://ingest.latitude.so/v1/traces',
        headers: {
          Authorization: `Bearer ${process.env.LATITUDE_API_KEY}`,
          'X-Latitude-Project': process.env.LATITUDE_PROJECT_SLUG!,
        },
        timeoutMillis: 5000,
      });
      const safeExporter: Exporter = {
        export(spans, done) {
          try {
            exporter.export(spans.map(privateLatitudeSpan), done);
          } catch {
            done({ code: 1 });
          }
        },
        shutdown: () => exporter.shutdown(),
        forceFlush: () => exporter.forceFlush(),
      };
      const sdk = new Latitude({
        apiKey: process.env.LATITUDE_API_KEY!,
        project: process.env.LATITUDE_PROJECT_SLUG!,
        serviceName: 'riverz-crm',
        instrumentations: [createAnthropicInstrumentation(AnthropicSDK)],
        exporter: safeExporter,
      });
      await sdk.ready;
      state.instance = sdk;
      return sdk;
    } catch {
      // Telemetry must not prevent boot or cause a customer action to be retried.
      console.warn('[latitude] tracing initialization failed');
      return null;
    }
  })();
  return state.starting;
}

export async function flushLatitudeTracing() {
  try {
    await state.instance?.flush();
  } catch {
    console.warn('[latitude] trace flush failed');
  }
}

/** Executes work exactly once, even if the telemetry SDK fails after work completes. */
export async function withLatitudeTrace<T>(
  name: string,
  context: LatitudeContext,
  work: () => Promise<T>,
  options: {
    attributes?: () => Record<string, string | number>;
    resultAttributes?: (result: T) => Record<string, string | number>;
    resultFailed?: (result: T) => boolean;
  } = {}
): Promise<T> {
  const sdk = await initLatitudeTracing();
  if (!sdk) return work();
  const parent = turn.getStore();
  const current = {
    ...parent,
    ...context,
    privateValues: [
      ...(parent?.privateValues ?? []),
      ...(context.privateValues ?? []),
    ],
  };
  let entered = false;
  let succeeded = false;
  let result: T;
  let failure: unknown;
  const run = async () => {
    entered = true;
    try {
      result = await turn.run(current, work);
      succeeded = true;
      return result;
    } catch (error) {
      failure = error;
      throw error;
    }
  };
  try {
    await capture(
      name,
      () =>
        sdk.getTracer('riverz').startActiveSpan(name, async (span) => {
          span.setAttributes({
            'gen_ai.operation.name': 'invoke_agent',
            'gen_ai.agent.name': name,
            ...options.attributes?.(),
          });
          rememberPrivateValues(
            span.spanContext().traceId,
            current.privateValues
          );
          try {
            const value = await run();
            try {
              if (options.resultAttributes)
                span.setAttributes(options.resultAttributes(value));
              if (options.resultFailed?.(value))
                span.setStatus({ code: 2, message: 'tool_reported_error' });
            } catch {
              /* A telemetry annotation cannot undo a completed action. */
            }
            return value;
          } catch (error) {
            span.setStatus({ code: 2, message: 'operation_failed' });
            throw error;
          } finally {
            span.end();
          }
        }),
      {
        sessionId: current.sessionId
          ? latitudeId(`session:${current.workspaceId}`, current.sessionId)
          : undefined,
        userId: current.userId
          ? latitudeId(`user:${current.workspaceId}`, current.userId)
          : undefined,
        tags: [
          process.env.NODE_ENV ?? 'development',
          ...(current.channel ? [current.channel] : []),
        ],
        metadata: {
          workspace: latitudeId('workspace', current.workspaceId),
          ...(current.agentId
            ? { agent: latitudeId('agent', current.agentId) }
            : {}),
        },
      }
    );
  } catch {
    if (!entered) return work();
    if (!succeeded) throw failure;
  }
  return result!;
}

export function traceTool<T>(
  name: string,
  work: () => Promise<T>,
  input?: unknown
): Promise<T> {
  const context = turn.getStore();
  if (!context) return work();
  return withLatitudeTrace(`tool:${name}`, context, work, {
    attributes: () => ({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': name,
      ...(input !== undefined
        ? {
            'gen_ai.tool.call.arguments': JSON.stringify(
              scrubLatitudeValue(input)
            ),
          }
        : {}),
    }),
    resultAttributes: (result) => ({
      'gen_ai.tool.call.result':
        typeof result === 'string'
          ? result
          : JSON.stringify(scrubLatitudeValue(result)),
    }),
    resultFailed: (result) => {
      if (typeof result !== 'string') return false;
      try {
        const value = JSON.parse(result);
        return Boolean(value?.error || value?.ok === false);
      } catch {
        return false;
      }
    },
  });
}

/** fetch-based fallback providers do not pass through the Anthropic instrumentation. */
export function traceCompatibleCompletion<
  T extends { text: string; uso: { prompt: number; salida: number } },
>(
  context: LatitudeContext,
  request: { provider: string; model: string; system: string; user: string },
  work: () => Promise<T>
): Promise<T> {
  return withLatitudeTrace(`chat ${request.model}`, context, work, {
    attributes: () => ({
      'gen_ai.operation.name': 'chat',
      'gen_ai.provider.name': request.provider,
      'gen_ai.request.model': request.model,
      'gen_ai.system_instructions': JSON.stringify([
        { type: 'text', content: request.system },
      ]),
      'gen_ai.input.messages': JSON.stringify([
        { role: 'user', parts: [{ type: 'text', content: request.user }] },
      ]),
    }),
    resultAttributes: (result) => ({
      'gen_ai.response.model': request.model,
      'gen_ai.usage.input_tokens': result.uso.prompt,
      'gen_ai.usage.output_tokens': result.uso.salida,
      'gen_ai.output.messages': JSON.stringify([
        { role: 'assistant', parts: [{ type: 'text', content: result.text }] },
      ]),
    }),
  });
}
