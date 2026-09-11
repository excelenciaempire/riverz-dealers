/** Only repeat reads: a timed-out write may already have committed. */
const READ_ONLY_RPCS = new Set(['admin_cron_health', 'admin_workspace_issues']);
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

export async function resilientDatabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  const url = new URL(request?.url ?? String(input));
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/)?.[1];
  const readable = (method === 'GET' || method === 'HEAD') && !rpc ||
    method === 'POST' && !!rpc && READ_ONLY_RPCS.has(rpc);
  const signal = init?.signal ?? request?.signal;
  // Request streams cannot be replayed. Supabase passes a URL + JSON string.
  if (!readable || request) return fetch(input, init);

  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(input, init);
      if (attempt >= 1 || !TRANSIENT_STATUSES.has(response.status)) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (attempt >= 1 || signal?.aborted || !(error instanceof TypeError)) throw error;
    }
    // Jitter prevents all synchronizers repeating the same burst together.
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 400));
  }
}
