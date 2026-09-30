export type McpClient = 'claude' | 'claude-chat' | 'codex' | 'chatgpt';

export interface OAuthConnectionToken {
  name: string;
  origin: string;
  client_id: string | null;
  expires_at: string | null;
  last_used_at: string | null;
}

/** Only a live OAuth credential actually used by an MCP client proves connection. */
export function connectedClients(
  tokens: OAuthConnectionToken[],
  now = Date.now()
): Set<McpClient> {
  const connected = new Set<McpClient>();
  for (const token of tokens) {
    if (
      token.origin !== 'oauth' ||
      !token.client_id ||
      !token.last_used_at ||
      !token.expires_at ||
      !(Date.parse(token.expires_at) > now)
    )
      continue;

    if (/claude[\s_-]*code/i.test(token.name)) connected.add('claude');
    else if (/claude|anthropic/i.test(token.name)) connected.add('claude-chat');
    else if (/codex/i.test(token.name)) connected.add('codex');
    else if (/chatgpt|openai/i.test(token.name)) connected.add('chatgpt');
  }
  return connected;
}
