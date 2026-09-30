export const MCP_URL = 'https://riverz.co/api/mcp';
export const CHATGPT_SETTINGS_URL = 'https://chatgpt.com/#settings/Connectors';
export const CHATGPT_INSTALL_URL =
  'https://chatgpt.com/plugins?create-connector=true';
export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/customize/connectors';
export const CLAUDE_INSTALL_URL = `${CLAUDE_CONNECTORS_URL}?${new URLSearchParams(
  {
    modal: 'add-custom-connector',
    connectorName: 'Riverz',
    connectorUrl: MCP_URL,
  }
)}`;
export const CLAUDE_DESKTOP_URL = 'claude://claude.ai/new';

/** Public installation configuration; credentials are obtained through OAuth. */
export function editorInstallUrl(client: 'cursor' | 'vscode'): string {
  if (client === 'cursor') {
    const config = btoa(JSON.stringify({ url: MCP_URL }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=riverz&config=${encodeURIComponent(config)}`;
  }
  return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'riverz', type: 'http', url: MCP_URL }))}`;
}

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
