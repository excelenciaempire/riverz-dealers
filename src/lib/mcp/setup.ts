export const MCP_URL = 'https://riverz.co/api/mcp';
export const CHATGPT_SETTINGS_URL = 'https://chatgpt.com/#settings/Connectors';

export const MCP_SETUP_COMMANDS = {
  claude: `claude mcp add --transport http --scope user riverz ${MCP_URL}\nclaude mcp login riverz`,
  codex: `codex mcp add riverz --url ${MCP_URL}\ncodex mcp login riverz`,
} as const;

/** Official desktop schemes prefill a request; the user reviews and sends it. */
export function desktopSetupUrl(
  client: keyof typeof MCP_SETUP_COMMANDS,
  request: string
): string {
  const base =
    client === 'claude' ? 'claude://code/new?q=' : 'codex://new?prompt=';
  return `${base}${encodeURIComponent(request)}`;
}
