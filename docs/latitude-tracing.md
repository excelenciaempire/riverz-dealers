# Latitude tracing

Riverz exports server-side AI traces to the Latitude project `riverz-s-project`.
This is optional and independent of Sentry. It does not change provider calls,
wallet billing, tool permissions, retries, prompts or customer delivery.

## Configuration

Set these server secrets in `.env.local` for development and in the Render
`riverz-crm` service for production:

```dotenv
LATITUDE_API_KEY=<organization API key>
LATITUDE_PROJECT_SLUG=riverz-s-project
LATITUDE_TRACING_ENABLED=true
```

Set `LATITUDE_TRACING_ENABLED=false` to stop exports. Missing credentials also
disable tracing. Never use `NEXT_PUBLIC_*` for the key. Restart/redeploy after
changing environment variables; no telemetry account is created by the app.

The SDK initializes before the scheduler starts. A process-wide singleton avoids
duplicate processors across Next server bundles. The SDK handles graceful
shutdown; Riverz also requests a flush when stopping the scheduler. Existing
observability, when configured, initializes first.

## Coverage

- Anthropic calls are instrumented automatically, including consumed streams.
- Customer-agent turns, comment replies, followups, text completions and Operator
  turns have capture boundaries. Tool calls have input/output, timing and failure
  status. Fetch-based fallback providers expose model, messages and token usage.
- Conversation/thread and user identifiers are HMAC pseudonyms, scoped by
  workspace. Tags distinguish channel and runtime environment.
- The telemetry wrappers execute application work once. Export or annotation
  failure cannot retry an order or invalidate an already completed action.

## Export privacy

Sanitization runs on a copy immediately before export, covering span attributes,
events, error status and resource attributes. It removes credentials, known
contact names, phone/email fields, signed URLs and binary image/document content.
The original model input and application data are untouched.

Free-text redaction is best effort: unknown names, addresses or sensitive facts
inside prose can still be present. Only send data necessary for debugging. Use
Latitude project privacy controls as additional protection. Customer summaries
are not separately exported as memory records; they can occur inside the model's
prompt. The current integration targets the Next application, not the separate
Python voice workers or the developer's Claude Code sessions.

## Verification

Run a safe application flow, flush the SDK for short-lived scripts, then inspect
`latitude traces list`, `latitude traces listSpans` and `latitude traces getSpan`.
The CLI needs `LATITUDE_API_KEY` in its environment (it does not load Next's
`.env.local` automatically). Check the model, input/output/cache tokens,
pseudonymous session/user, tool status and sanitized message contents.

Keep trace exports and generated reports local: they can include conversation
content. `artifacts/` and `tmp/` are ignored by Git.
